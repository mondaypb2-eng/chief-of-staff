# Sync & Brief: Time-Box & Nudge

Build a realistic plan for the requested day and save it with save_daily_plan.

## Steps
1. Call get_day(date). It returns the fixed events, travel time to and from off-site events, lunch, the computed free_slots, and the open tasks (due that day, overdue, or undated).
2. Call get_stale_tasks for the open tasks nobody has touched for a while.
3. Gather context for each event and each high-priority task (see Context Linker).
4. Time-box: put tasks only into free_slots.
   - Order: overdue and due-today high priority first, then tasks that prepare for today's or tomorrow's events (e.g. read the contract before the meeting, so schedule it before that event), then the rest by priority.
   - Use each task's duration_min. A slot must fit the whole task. You may split a task of 90 minutes or more into two blocks, and the block titles should say so ("(1/2)").
   - Don't fill every minute. Leave about 20% of free time open for the unexpected. Put a 10–15 minute break after 2 hours of back-to-back focused work.
   - Tasks that need a place (location) go next to a trip already in the plan when that makes sense ("on the way back from ABC, stop at ...").
   - If tasks don't fit, put them in `unscheduled` with a reason. Don't squeeze them in.
   - Include the events and travel blocks from get_day in `blocks` so the plan reads as a full day. Copy their times exactly.
5. Nudge: for each stale task, write one short, friendly, specific Thai message in `nudges`. Suggest the smallest next step, or ask whether to drop it ("ค้างมา 20 วันแล้ว — ใช้เวลาแค่ 15 นาที แทรกช่วง 15:00 ได้ไหม หรือจะยกเลิก?"). Only stale tasks get a nudge. Don't nag about everything.
6. Call save_daily_plan. If it rejects the plan, fix every problem it lists and save again.

## Reply
After saving, reply with the morning brief in Thai, at most about 12 lines:
- one opening line (how full the day is, the one thing that matters most)
- the timeline (time · what), with 📎 under an item when it has linked context
- ⚠️ nudges
- ❓ open clarifications from list_clarifications, if there are any
