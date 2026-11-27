<?php
// Personal Chief of Staff — PHP side (UI + bridge to the Node agent)
mb_internal_encoding('UTF-8');
date_default_timezone_set('Asia/Bangkok');
define('APP_ROOT', __DIR__);
define('SETTINGS_FILE', APP_ROOT . '/storage/settings.json');

function settings(): array {
    static $s = null;
    if ($s !== null) return $s;
    $def = [
        'provider' => 'ollama',
        'ollama' => ['url' => 'http://127.0.0.1:11434', 'model' => 'qwen3:4b', 'embed_model' => 'bge-m3', 'num_ctx' => 8192, 'think' => false, 'keep_alive' => '30m', 'timeout_sec' => 300],
        'api_key' => '', 'model' => 'claude-opus-5-5', 'effort' => 'medium',
        'node_path' => 'C:\\nvm4w\\nodejs\\node.exe',
        'db' => ['host' => '127.0.0.1', 'port' => 3307, 'user' => 'root', 'password' => '', 'database' => 'chief_of_staff'],
        'profile' => ['name' => '', 'work_start' => '09:00', 'work_end' => '18:00', 'lunch_start' => '12:00', 'lunch_end' => '13:00',
                      'default_travel_min' => 30, 'buffer_min' => 10, 'stale_days' => 5],
    ];
    $saved = is_file(SETTINGS_FILE) ? (json_decode(file_get_contents(SETTINGS_FILE), true) ?: []) : [];
    $s = array_replace_recursive($def, $saved);
    return $s;
}

function save_settings(array $new): void {
    $cur = is_file(SETTINGS_FILE) ? (json_decode(file_get_contents(SETTINGS_FILE), true) ?: []) : [];
    file_put_contents(SETTINGS_FILE, json_encode(array_replace_recursive($cur, $new), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function pdo(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = settings()['db'];
    $pdo = new PDO("mysql:host={$c['host']};port={$c['port']};dbname={$c['database']};charset=utf8mb4", $c['user'], $c['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec("SET time_zone = '+07:00'");
    return $pdo;
}

function db_ok(): ?string {
    try { pdo()->query('SELECT 1 FROM tasks LIMIT 1'); return null; }
    catch (Throwable $e) { return $e->getMessage(); }
}

function rows(string $sql, array $p = []): array { $st = pdo()->prepare($sql); $st->execute($p); return $st->fetchAll(); }
function row(string $sql, array $p = []): ?array { $r = rows($sql, $p); return $r[0] ?? null; }

/** Installed Ollama models (null if Ollama isn't running). */
function ollama_models(): ?array {
    static $cache = false;
    if ($cache !== false) return $cache;
    $ch = curl_init(rtrim(settings()['ollama']['url'], '/') . '/api/tags');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 2, CURLOPT_CONNECTTIMEOUT => 1]);
    $raw = curl_exec($ch);
    $ok = $raw !== false && curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
    curl_close($ch);
    $cache = $ok ? array_column(json_decode($raw, true)['models'] ?? [], 'name') : null;
    return $cache;
}

function engine_label(): string {
    $s = settings();
    return $s['provider'] === 'claude' ? 'Claude · ' . $s['model'] : 'Local · ' . $s['ollama']['model'];
}

/** Why the AI engine can't run right now, or null if it's ready. */
function ai_problem(): ?string {
    $s = settings();
    if ($s['provider'] === 'claude') return trim($s['api_key']) === '' ? 'ยังไม่ได้ใส่ Anthropic API key' : null;
    $models = ollama_models();
    if ($models === null) return 'Ollama ไม่ได้เปิดอยู่ — เปิดโปรแกรม Ollama ก่อน';
    $want = $s['ollama']['model'];
    $has = fn($m) => in_array($m, $models, true) || in_array("$m:latest", $models, true);
    if (!$has($want)) return "ยังไม่มีโมเดล $want — รันคำสั่ง: ollama pull $want";
    if (!$has($s['ollama']['embed_model'])) return "ยังไม่มีโมเดล {$s['ollama']['embed_model']} — รัน: ollama pull {$s['ollama']['embed_model']}";
    return null;
}

function ai_ready(): bool { return ai_problem() === null; }

function node_path(): ?string {
    $p = settings()['node_path'];
    return is_file($p) ? $p : null;
}

/** Run a Node script with optional JSON on stdin; returns decoded JSON (or raw text). */
function run_node(array $args, ?array $stdin = null, int $timeout = 600) {
    $node = node_path();
    if (!$node) return ['ok' => false, 'error' => 'ไม่พบ node.exe — ตั้งค่า path ในหน้าตั้งค่า'];
    $proc = proc_open(array_merge([$node], $args), [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, APP_ROOT . '/mcp');
    if (!is_resource($proc)) return ['ok' => false, 'error' => 'เปิด Node ไม่สำเร็จ'];
    fwrite($pipes[0], $stdin === null ? '' : json_encode($stdin, JSON_UNESCAPED_UNICODE));
    fclose($pipes[0]);
    stream_set_blocking($pipes[1], false); stream_set_blocking($pipes[2], false);
    $out = $err = ''; $t = time();
    while (true) {
        $out .= stream_get_contents($pipes[1]); $err .= stream_get_contents($pipes[2]);
        $st = proc_get_status($proc);
        if (!$st['running']) break;
        if (time() - $t > $timeout) { proc_terminate($proc); $err .= "\n(timeout)"; break; }
        usleep(100000);
    }
    $out .= stream_get_contents($pipes[1]); $err .= stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]); proc_close($proc);
    $j = json_decode($out, true);
    return is_array($j) ? $j : ['ok' => false, 'error' => trim($err ?: $out) ?: 'ไม่มีผลลัพธ์จาก Node', 'raw' => $out, 'stderr' => $err];
}

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function prompt_text(string $n): string { return file_get_contents(APP_ROOT . "/prompts/$n.md"); }

function thai_date(?string $d, bool $withTime = false): string {
    if (!$d) return '—';
    $t = strtotime($d);
    $days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    $months = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    $s = $days[date('w', $t)] . ' ' . date('j', $t) . ' ' . $months[(int)date('n', $t)];
    return $withTime ? $s . ' ' . date('H:i', $t) : $s;
}
