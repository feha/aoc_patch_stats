// ==UserScript==
// @name         aoc_patch_times
// @icon         https://adventofcode.com/favicon.png
// @namespace    
// @version      0.1
// @description  Patches the bug in AoC where their timekeeping accidentally stores time since questions release, rather than time since user started the question.
// @author       F
//// @include      /^https?://.*/
// @match https://adventofcode.com/*
// @match https://adventofcode.com*
//// @include /.*://https://adventofcode.com//?/
// @grant       GM_getValue
// @grant       GM_setValue
// @noframes
//// @run-at document_end
// ==/UserScript==

// TODO Make persistent data somehow get stored attached to your AoC account.
//      Doesn't seem possible: there's no field to store data in aside from the
//       actual timestamp for each star - and that is time-diff since question
//       was released, so you have little control over its value.
//      Not to mention how using it would collide with using the site normally...

console.log("aoc_patch_times readied");
// const script = (function(jnode) {
(async function() {
    'use strict';

console.log("aoc_patch_times start!");


//#region Settings/constants/templates

const PARTS_PER_DAY = 2;

const SELECTOR_QUESTION = ".day-desc";
const SELECTOR_SUCCESS = ".day-success";
const SELECTOR_SUCCESS_STAR_COUNTER = "p";

const KEY_TIMEKEEPING = "timekeeping";
const KEY_STARTS = "starts";
const KEY_STARS = "stars";
const KEY_RESUME = "resume";

let get_stored_json = async (key) => {
    // const v = window.localStorage.getItem(key);
    const v = await GM_getValue(key, "{}"); // TODO Don't await, use promise to start things. Call main?
    return JSON.parse(v);
}
let set_stored_json = async (key, json) => {
    // window.localStorage.setItem(key, JSON.stringify(json));
    return GM_setValue(key, JSON.stringify(json));
}
let STORED_TIMEKEEPING = await get_stored_json(KEY_TIMEKEEPING);

const aoc_url = "https://adventofcode.com";
const aoc_year_url = (year) => aoc_url + `/${year}`;
const aoc_day_url = (year, day) => aoc_year_params(year) + `/day/${day}`;
const aoc_input_url = (year, day) => aoc_day_params(year, day) + `/input`;
const aoc_answer_url = (year, day) => aoc_day_params(year, day) + `/answer`;

const aoc_trigger_start_regex = new RegExp('^https://adventofcode.com/(\\d{4,})/day/(\\d+)/?(#[^/]*)*');
const aoc_trigger_end_regex = new RegExp('^https://adventofcode.com/(\\d{4,})/day/(\\d+)/answer/?$');
const aoc_leaderboard_regex = new RegExp('^https://adventofcode.com/(\\d{4,})/leaderboard.*');
const aoc_stats_regex = new RegExp('^https://adventofcode.com/(\\d{4,})/leaderboard/self/?$');

//#endregion


//#region Helpers

const unique = (arr) => [...new Set(arr)];

const set_visible = (e, visible) => visible ? e.removeAttribute("hidden") : e.setAttribute("hidden", "");

const replace_nodeName = (node, new_tagName) => {
    // console.log("replace_nodename",node,node.attributes);
    const new_node = document.createElement(new_tagName);
    [...node.attributes].forEach((attr) => new_node.setAttribute(attr.name, attr.value));
    new_node.innerHTML = node.innerHTML;
    node.parentNode.replaceChild(new_node, node)
    return new_node
};

const sleep = (ms) => {
    const date = Date.now();
    while (Date.now() - date < ms) {};
};

const msPerMs = 1;
const msPerSecond = 1000;
const msPerMinute = msPerSecond * 60;
const msPerHour = msPerMinute * 60;
const msPerDay = msPerHour * 24;
const msPerWeek = msPerDay * 7;
const msPerMonth = msPerDay * 30;
const msPerYear = msPerMonth * 365;
const time_length = (timestamp_diff, format) => {
    // const start = new Date(timestamp_start);
    // const end = new Date(timestamp_end);

    if (timestamp_diff == undefined) { return [undefined, undefined] }

    let diff = parseInt(timestamp_diff) // allow for strings
    let msPerUnit = [msPerYear, msPerMonth, msPerDay, msPerHour, msPerMinute, msPerSecond, msPerMs];
    let count = msPerUnit.map(ms => {
        let s = "" + Math.floor(diff / ms);
        diff = diff % ms;
        return s;
    });
    const units_short = ["Y", "M", "d", "h", "m", "s", "ms"]
    const units = ["year", "month", "day", "hour", "minute", "second", "millisecond"]
            .map((unit, i) => ({ short: units_short[i], name: unit }));
    
    count = count
            .map((n, i) => (""+n).padStart(format[i].length, "0"))
            // .map((s, i) => [s, units[i]])]
    return [count, units];
};

const get_time_since = (timestamp) => {
    const msPerSecond = 1000;
    const msPerMinute = msPerSecond * 60;
    const msPerHour = msPerMinute * 60;
    const msPerDay = msPerHour * 24;
    const msPerWeek = msPerDay * 7;
    const msPerMonth = msPerDay * 30;
    const msPerYear = msPerMonth * 365;
    const now = new Date();
    const then = new Date(timestamp);
    const diff = new Date(now - then);
    const units = ["year", "month", "day", "hour", "minute", "second"].reverse();
    const msPerUnit = [msPerYear, msPerMonth, msPerDay, msPerHour, msPerMinute, msPerSecond].reverse();
    const idx = msPerUnit.reduce((r, ms, i) => diff < ms ? r : i, "now");
    return `${parseInt(diff / msPerUnit[idx])} ${units[idx]}s ago`;
};

const waitForKeyElement = (selector, callback) => {
    const e = document.querySelector(selector);
    if (e) {
        callback(e);
    } else {
        new MutationObserver((mutations, observer) => {
            const e = document.querySelector(selector);
            if (e) {
                observer.disconnect();
                callback(e);
            }
        }).observe(document.body, {childList:true, subtree:true});
    }
};

//#endregion


//#region entry-point

const main = () => {
    console.log("PRE_SUPER DEBUG:\n", { ...STORED_TIMEKEEPING });
    // local storage already retrieved

    // check domain for triggers (opened question; gave answer)
    let trigger_start = location.href.match(aoc_trigger_start_regex);
    let trigger_end = location.href.match(aoc_trigger_end_regex);

    // opened question
    if (trigger_start !== null) {
        let year = parseInt(trigger_start[1], 10);
        let day = parseInt(trigger_start[2], 10);

        let days = STORED_TIMEKEEPING[year] = (STORED_TIMEKEEPING[year] || {});
        let timestamps = days[day] = (days[day] || {});

        // let parts = time[KEY_PARTS] = (time[KEY_PARTS] || {});
        let starts = timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []);
        let first_any = false;
        document.body.querySelectorAll(SELECTOR_QUESTION).forEach((_, i) => {
            let part = i+1;
            let first = starts[i] === undefined;
            first_any = first_any || first;

            if (first) {
                console.log(`TRIGGER>START>PART${part}>FIRST_OPEN: Storing timestamp.`);
                
                starts.push( Date.now() );
            }
            
            let tail_length = starts.length - part;
            if (first && tail_length !== 0) {
                console.log(`[WARNING] TRIGGER>START> Warn(Code: 0): Somehow has ${tail_length} more parts on first open of part${part}."`);
            }
        });
        if (!first_any && starts.length < PARTS_PER_DAY) {
            console.log(`TRIGGER>START>RESUMING: Storing resume log.`);
            let resume = timestamps[KEY_RESUME] = timestamps[KEY_RESUME] || [];
            resume.push( Date.now() );
        }
        
        console.log(`  Current stats:\n`, timestamps);

        set_stored_json(KEY_TIMEKEEPING, { ...STORED_TIMEKEEPING });
    }

    // gave answer
    if (trigger_end !== null) {
        let year = parseInt(trigger_end[1], 10);
        let day = parseInt(trigger_end[2], 10);

        let days = STORED_TIMEKEEPING[year];
        if (days === undefined) {
            console.log(`[WARNING] TRIGGER>END> Warn(Code: 0): User somehow answered a year before starting it.`);
            days = STORED_TIMEKEEPING[year] = {};
        }

        let timestamps = days[day];
        if (timestamps === undefined) {
            console.log(`[WARNING] TRIGGER>END> Warn(Code: 1): User somehow answered a day before starting it.`);
            timestamps = days[day] = {}
        }

        let stars = timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []);
        let star_count = stars.length;

        let success = document.body.querySelector(SELECTOR_SUCCESS);
        if (success === null) {
            console.log("TRIGGER( END ): Incorrect answer.");
        } else {
            let count = document.body.querySelectorAll(SELECTOR_SUCCESS_STAR_COUNTER);

            let diff = count.length - star_count;
            if (diff < 0) {
                console.log(`[WARNING] TRIGGER>END> Warn(Code: 2): User somehow has ${-diff} more stars than they solved.`);
            } else if (diff >= 2) {
                console.log(`[WARNING] TRIGGER>END> Warn(Code: 3): User somehow has more than one new star, for a total of ${diff}.`);
            }

            count.forEach((_, i) => {
                let part = i+1;
                let first = stars[i] === undefined;
                if (part > star_count) {
                    console.log(`TRIGGER>END>PART${part}>NEW_STAR: Storing timestamp.`);
                    
                    stars.push( Date.now() );
                }
            });
        }

        console.log(`  Current stats:\n`, timestamps);

        set_stored_json(KEY_TIMEKEEPING, STORED_TIMEKEEPING);
    }

    // stats
    let stats = location.href.match(aoc_stats_regex);
    if (stats !== null) {
        let year = parseInt(stats[1], 10);

        let days = STORED_TIMEKEEPING[year];
        if (days === undefined) {
            console.log(`[WARNING] LEADERBOARD> Warn(Code: 0): User has statistic for untracked year = ${year}`);
            days = STORED_TIMEKEEPING[year] = {};
        }
        
        let node = document.querySelector("pre").lastChild;

        let lines = node.textContent.split('\n');

        let re_pre = /^(\s+\d+).+$/
        let re_day = /^\s+(\d+)$/
        let re_parts = /\s*[^\s]+\s+[-\d]+\s+[-\d]+/g
        let re_time = /(\s{2})\s*([^\s]+)(\s+[-\d]+\s+[-\d]+)/
        let lines_patched = lines.map((line) => {
            let pre = line.match(re_pre);
            if (pre !== null) {
                pre = pre[1];
                console.log(`"${pre}"`);
                let day = pre.match(re_day)[1];
                console.log(`"${day}"`);
                let parts = line.slice(pre.length).match(re_parts);
    
                let timestamps = days[day];
                if (timestamps === undefined) {
                    console.log(`[WARNING] LEADERBOARD> Warn(Code: 0): User has statistic for untracked day = ${day}`);
                    timestamps = days[day] = {};
                }
                
                let starts = timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []);
                let stars = timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []);
                let diffs = stars.map((end, i) => end - starts[i]);

                
                let parts_patched = parts.map((part, i) => {
                    const format = ["yyyy", "mm", "dd", "hh", "mm", "ss", "000"];
                    const delim = ":";
                    const display_size = 3;
                    let [diff, units] = time_length(diffs[i], format);
                    if (diff !== undefined) {
                        let idx_limit = units.findIndex(unit => unit.short == "h");
                        idx_limit = Math.min(idx_limit, diff.length - display_size);
                        diff = diff
                                .filter((_,i) => i >= idx_limit)
                                .filter((_,i) => i < display_size)
                                .join(delim).padStart(10, ' ');
                    }
                    let part_patched = part.match(re_time).slice(1)
                            .map((cap, i) => i==1 ? (diff || `'${cap}'`.padStart(10, ' ')) : cap )
                            .join('');
                    return part_patched;
                });
                
                return pre + parts_patched.join('');
            }
            ""
        }).join('\n');

        node.textContent = lines_patched;
    }

    console.log("SUPER DEBUG:\n", STORED_TIMEKEEPING);
};
main();

console.log("aoc_patch_times finished!");

})();
// });