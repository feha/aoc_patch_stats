# AoC Time Patcher

This is a userscript for AoC timekeeping.

AoC has since long had a bug where the timekeeping accidentally gives time since **the question was released**, rather than the users completion-time.

The bug is presumably rooted in the fact that AoC has never stored or exposed the starting-times of users. Not even when they retrieve the Json data.

This userscript aims to patch that, by storing timestamps for when a user starts and completes each part.

## Usage

Add it to your userscript extension of your choice, and then it should run whenever you visit the relevant domains.

This userscript currently targets these url's:

* `https://adventofcode.com/yyyy/day/dd`
  * Whenever it notices you look at a question it thinks you haven't finished, it logs a timestamp to the `'starts'` key (likely to rename due to identifier-similarity). Mainly it allows the script to keep track of when you began each part, but it also has a log under the key `'resume'` to let you keep track of when you resume (likely to change, see below).
  * It accepts the part2-versions of the url, where something along the lines of `#part2` is at the end of the url.
* `https://adventofcode.com/yyyy/day/dd/answer`
  * Whenever it notices you tried to give an answer, it checks AoC's reply. If incorrect it does nothing, while if a star was gained it adds a timestamp to the `'stars'` key.
* `https://adventofcode.com/yyyy/leaderboard/self`
  * The script aims to mutate this leaderboard, to expose patched completion-times rather than the bugged ones AoC exposes. If an entry lacks a completion-time tracked by the script it leaves the existing item, except wrapped in single-quotes to signal this. ie. `42:06:90 -> '42:06:90'`.

## Not Implemented
There are various features that would be desirable to have, but has yet to be implemented.

### Proper breaks
Currently it only keeps track of when you resume, so calculating the length of a break would take some guesswork and is impossible. It does this by seeing that you opened a 'day' that it thinks is in progress.

Ideally a proper break-taking system should be implemented, where user can explicitly tell the script that they start/end a break.

### Other leaderboards
Currently only exposes this data on your personal leaderboard.

Not that it would make much sense to do so for any leaderboards populated with other users, considering there's no way for this script to have their data.

### Persistent data
This userscript is currently unable to persist it's data, and as such it will only survive as long as your harddrives do.
To be exact, it stores it in *greasemonkey*/*tampermonkeys* version of localstorage, so you could technically migrate or backup the data if you know where it stores that.

Sadly, I have been unable to figure out how to store the data persistently on the AoC account. There is no setting that allows the user to fill with encoded json-data without breaking anything.

* Leaderboards has no name, and the join code is both randomized and short.
* Usernames are not editable.
* Generating Auth accounts and storing data through their completion-times of known questions is impractical to the extreme.
* Storing it on the cloud has the same issue as localstorage, where it's not tied to the account and as such will be lost when AoC inevitably outlives Amazon and Google.

