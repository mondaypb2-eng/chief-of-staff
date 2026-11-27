<?php
require __DIR__ . '/config.php';
header('Content-Type: application/json; charset=utf-8');
set_time_limit(900);
ignore_user_abort(true);

$action = $_GET['action'] ?? '';
$in = json_decode(file_get_contents('php://input'), true) ?: [];
$out = ['ok' => false, 'error' => 'unknown action'];

try {
    switch ($action) {
        case 'capture':
            $text = trim((string)($in['text'] ?? ''));
            if ($text === '') throw new RuntimeException('พิมพ์หรือพูดอะไรสักอย่างก่อน');
            if (mb_strlen($text) > 4000) throw new RuntimeException('ข้อความยาวเกิน 4,000 ตัวอักษร');
            $out = run_node(['agent/run.js'], ['mode' => 'capture', 'text' => $text]);
            break;
        case 'brief':
            $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $in['date'] ?? '') ? $in['date'] : date('Y-m-d');
            $out = run_node(['agent/run.js'], ['mode' => 'brief', 'date' => $date]);
            break;
        case 'answer':
            // answer a clarification: hand the original fragment + answer back to capture mode
            $c = row("SELECT * FROM clarifications WHERE id=? AND status='open'", [(int)($in['id'] ?? 0)]);
            if (!$c) throw new RuntimeException('ไม่พบคำถามนี้');
            $ans = trim((string)($in['answer'] ?? ''));
            if ($ans === '') throw new RuntimeException('ยังไม่ได้ตอบ');
            $text = "ตอบคำถามที่ค้างไว้ (clarification id {$c['id']}):\nเรื่องเดิม: \"{$c['fragment']}\"\nคำถาม: {$c['question']}\nคำตอบ: {$ans}\nจัดการเรื่องเดิมตามคำตอบนี้ แล้ว resolve_clarification id {$c['id']}";
            $out = run_node(['agent/run.js'], ['mode' => 'capture', 'text' => $text]);
            break;
        case 'dismiss':
            pdo()->prepare("UPDATE clarifications SET status='dismissed', resolved_at=NOW() WHERE id=?")->execute([(int)$in['id']]);
            $out = ['ok' => true];
            break;
        case 'task_status':
            $st = in_array($in['status'] ?? '', ['todo', 'doing', 'done', 'cancelled'], true) ? $in['status'] : 'done';
            pdo()->prepare("UPDATE tasks SET status=?, last_touched_at=NOW() WHERE id=?")->execute([$st, (int)$in['id']]);
            $out = ['ok' => true];
            break;
        case 'shopping_status':
            $st = in_array($in['status'] ?? '', ['needed', 'bought', 'cancelled'], true) ? $in['status'] : 'bought';
            pdo()->prepare("UPDATE shopping_items SET status=? WHERE id=?")->execute([$st, (int)$in['id']]);
            $out = ['ok' => true];
            break;
        case 'event_cancel':
            pdo()->prepare("UPDATE events SET status='cancelled' WHERE id=?")->execute([(int)$in['id']]);
            $out = ['ok' => true];
            break;
        case 'setup_db':
            $args = ['setup.js'];
            if (!empty($in['reset'])) $args[] = '--reset';
            if (!empty($in['seed'])) $args[] = '--seed';
            $r = run_node($args, null, 120);
            $out = isset($r['raw']) && str_contains($r['raw'], 'ready') ? ['ok' => true, 'message' => trim($r['raw'])] : $r;
            break;
        case 'smoke':
            $r = run_node(['test/smoke.js'], null, 300);
            $text = ($r['raw'] ?? '') . ($r['stderr'] ?? '');
            $out = ['ok' => str_contains($text, 'all smoke checks passed'), 'output' => $text];
            break;
        case 'eval':
            if ($p = ai_problem()) throw new RuntimeException($p);
            $cases = array_values(array_filter((array)($in['cases'] ?? []), fn($c) => preg_match('/^\w+$/', $c)));
            $r = run_node(array_merge(['eval/run-eval.js'], $cases), null, 1800);
            $out = ['ok' => true, 'output' => ($r['raw'] ?? '') ?: ($r['error'] ?? '')];
            break;
    }
} catch (Throwable $e) {
    $out = ['ok' => false, 'error' => $e->getMessage()];
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
