# AoC Time Patcher

This is a userscript to fix AoC's timekeeping.

AoC has since long had a bug where the timekeeping accidentally gives time since **the question was released**, rather than the users completion-time.

The bug is presumably rooted in the fact that AoC has never stored or exposed the starting-times of users (difficult to expose something you don't have). Not even when they retrieve the Json data.

This userscript aims to patch that, by storing timestamps for when a user starts and completes each part.

## **Usage**

Add it to your userscript extension of your choice, and then it should run whenever you visit the relevant domains.

This userscript currently targets these url's:

* `https://adventofcode.com/yyyy/day/dd`
  * Whenever it notices you look at a question it thinks you haven't finished, it logs a timestamp to the `'starts'` key (likely to rename due to identifier-similarity). Mainly it allows the script to keep track of when you began each part, but it also has a log under the key `'resume'` to let you keep track of when you resume (likely to change, see below).
  * It accepts the part2-versions of the url, where something along the lines of `#part2` is at the end of the url.
  * The userscript inserts a little floating sidebar with your current timekeeping statistics for that day, including buttons for starting/ending breaks.
* `https://adventofcode.com/yyyy/day/dd/answer`
  * Whenever it notices you tried to give an answer, it checks AoC's reply. If incorrect it does nothing, while if a star was gained it adds a timestamp to the `'stars'` key.
* `https://adventofcode.com/yyyy/leaderboard/self`
  * The script aims to mutate this leaderboard, to expose patched completion-times rather than the bugged ones AoC exposes. If an entry lacks a completion-time tracked by the script it leaves the existing item, except wrapped in single-quotes to signal this. ie. `42:06:90 -> '42:06:90'`.

## **Not Implemented**
There are various features that would be desirable to have, but has yet to be implemented. For most of them there aren't any plans to implement them either.

### **Inheriting AoC Data For Untracked Stars**
When looking at stats right now it shows entries that exist on AoC but not the script. The script could instead read those stats, and insert them into the timekeeping.

The starts timestamp could easily be calculated from the year+Dec+day + knowledge of when AoC releases questions. Or it might alternatively be in the JSON data exposed by AoC.

The stars timestamp could be found in said exposed JSON data, or it should alternatively be possible to read from the personal-stats leaderboard (though it has a limit at '>24h').

### **Easy User Editing**
Would be nice to allow the user to easily edit the timekeeping manually, without having to edit json directly in tampermonkeys storage UI.

This could be useful for easily inserting known data from old years (if you tracked it back then), inserting or ending breaks where you failed to use the buttons, and most importantly, fixing/sanitizing your data after some inevitable (un)foreseen bug.

Preferably, something like clicking the elements directly in the timekeeping and leaderboard should turn the element into something editable. Though some other ui would be needed to add breaks belatedly after you already got the star.

### Impossibly Proper breaks
Currently it only keeps track of your breaks through manual buttons (and auto-resuming when completing a star).

Ideally, there would be some way for it to automagically know when you are on a break even when not told. But that is not within the capabilities of a userscript. It _could_ assume closing the tab means you take a break until you return, but that would obviously have more false positives than desireable.

### Other leaderboards
Currently only exposes this data on your personal leaderboard.

Not that it would make much sense to do so for any leaderboards populated with other users, considering there's no way for this script to have their data.

### Persistent data
This userscript is currently unable to persist it's data (beyond browser's localstorage/userscript-storage), and as such it will only survive as long as your harddrives do (or less if you, say, uninstall your browser).
To be exact, it stores data in *greasemonkey*/*tampermonkeys* version of localstorage if possible, so you could technically migrate or backup the data if you know where it stores that.

Sadly, I have been unable to figure out how to store the data persistently on the AoC account. There is no setting that allows the user to fill with encoded json-data without breaking anything.

* Leaderboards has no name, and the join code is both randomized and short.
* Usernames are not editable.
* Generating Auth accounts and storing data through their completion-times of known questions is impractical to the extreme.
* Storing it on the cloud has the same issue as localstorage, where it's not tied to the account and as such will be lost when AoC inevitably outlives Amazon and Google.

