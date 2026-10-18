# Glossary

Use one name per thing, the same way in the UI copy, this spec and the code.

| Term | Meaning | Notes |
| --- | --- | --- |
| **Week** | The one reusable plan, Monday to Sunday. It has no dates. | Code: `Plan` |
| **Activity** | Something you budget time for, like a class, your job or the gym. It has a name, a color, a shape and a budget. | Code: `Activity` |
| **Budget** | How many hours an activity needs, counted per week ("4 h per week") or per day on a number of days ("1 h 30 min per day, 3 days"). | Code: `mode`, `budgetMinutes` (type `BudgetMinutes`), `days` (type `DayCount`) |
| **Block** | One piece of an activity on the week: a day, a start time and a length. You add, move, resize and remove blocks. | Was "tile" in the prototype. Code: `Block` |
| **Slot** | A 15-minute cell on the week. An empty slot has no block. Blocks start and end on slots. | Everything snaps to 15 min |
| **Length** | How long a block is, in minutes. | Code: `length`, type `Length` |
| **Overnight block** | A block that runs past midnight into the next day, for example a night shift from Tuesday 22:00 to Wednesday 02:00. It is one block, drawn in two parts. Sunday night runs into Monday morning. | |
| **Default length** | The length a new block gets: the per-day budget for per-day activities, otherwise 1 h 30 min, and never more than what is left. | |
| **Placed** | The total length of an activity's blocks. | |
| **Left to place** | Budget minus placed. At zero it reads "All placed". Below zero it is "Over budget". | |
| **Placing** | The mode you are in after picking an activity: every click or tap on an empty slot adds a block of it, until you press Done or nothing is left. | Was "armed" in the prototype |
| **Add block** | Click or tap an empty slot when you are not placing, then choose the activity. | Phone: a bottom sheet. Desktop: a menu |
| **First free slot** | The earliest gap that fits the default length, scanning Monday to Sunday. | |
| **Day hours** | The hours you are usually awake and planning, by default 07:00 to 22:00. The week opens scrolled to them, and "First free slot" only looks inside them. The week always shows all 24 hours. | Was "hours shown". Code: `dayStart`, `dayEnd` |
| **Example week** | Sample activities and blocks shown on first run, until you keep them or start empty. | |
| **Export / Import** | Save the whole database as a `.db` file, or replace this browser's data with one. | Settings › Your data |

Words not to use in the app: **tile** (say "block"), **ledger** (it's the "Activities" list), **arm / armed** (say "placing"), and **event, appointment, task, session** (they suggest dates or to-dos, and this is one reusable week). Code may keep internal names that aren't user-facing, but prefer the glossary terms for new code.
