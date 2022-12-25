// ==UserScript==
// @name         aoc_patch_times
// @icon         https://adventofcode.com/favicon.png
// @namespace    
// @version      0.1
// @description  Patches the bug in AoC where their timekeeping accidentally stores time since questions release, rather than time since user started the question.
// @author       F
// @match https://adventofcode.com/*
// @match https://adventofcode.com*
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

const SELECTOR_TIMEKEEPING = ".timekeeping";
const SELECTOR_TIMEKEEPING_INNER = SELECTOR_TIMEKEEPING + "-inner";
const SELECTOR_IN_PROGRESS = ".in-progress";
const SELECTOR_TOTAL_IN_PROGRESS = ".total-in-progress";
const SELECTOR_BUTTON_BREAK_PARENT = ".button-parent";
const SELECTOR_BUTTON_BREAK = ".button-break";
const SELECTOR_BUTTON_RESUME = ".button-resume";
const SELECTOR_STAR_COUNT = ".star-count"
const SELECTOR_QUESTION = ".day-desc";
const SELECTOR_SUCCESS = ".day-success";
const SELECTOR_SUCCESS_STAR_COUNTER = "p";
const SELECTOR_SIDEBAR = "#sidebar";

const KEY_TIMEKEEPING = SELECTOR_TIMEKEEPING.slice(1);
const KEY_STARTS = "starts";
const KEY_STARS = "stars";
const KEY_BREAKS = "breaks";
const KEY_RESUMES = "resumes";

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

const set_visible = (e, visible) => visible ? e.setAttribute('style', '') : e.setAttribute('style', 'visibility: hidden;');
// const set_visible = (e, visible) => visible ? e.removeAttribute('hidden') : e.setAttribute('hidden', '');

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
const time_length = (diff, format) => {
    // const start = new Date(timestamp_start);
    // const end = new Date(timestamp_end);

    if (diff == undefined) { return [undefined, undefined] }

    diff = parseInt(diff) // allow for strings
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

// timestamps formatted for the timekeeping ui
const time_formatted = (diff) => {
    const format = ["yyyy", "mm", "dd", "hh", "mm", "ss", "000"];
    const delim = ":";
    let [duration] = time_length(diff, format);
    if (duration !== undefined) {
        let idx = duration.findIndex(n => n != 0);
        duration = duration
            .filter((_, i) => i >= idx)
            .slice(0, -1)
            .join(delim);
    }
    
    return duration;
}
// dates formatted for the timekeeping ui
const date_formatted = (date) => {
    const date_delim = "-";
    const middle_delim = ":";
    const clock_delim = ":";
    // date = date.toLocaleString("en-ZA", {year: "numeric", month: "2-digit", day: "2-digit"})
    //         + "-" + date.toLocaleString("en-ZA", {hour: "2-digit", minute: "2-digit", second: "2-digit"});
    date = [date.getUTCFullYear(), date.getUTCMonth()+1, date.getUTCDay()].map(s => (""+s).padStart(2, '0')).join(date_delim)
            + middle_delim
            + [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()].map(s => (""+s).padStart(2, '0')).join(clock_delim)
    
    return date;
}

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


const gui_css_str = () => {
    return [
        /*css*/`
        .hidden {
            visibility: hidden;
        }`,
        /*css*/`
        .${KEY_TIMEKEEPING} {
            position: sticky;
            top: 10%;
            float: right;
            clear: both;
        }`,
        /*css*/`
        .${KEY_TIMEKEEPING}-inner {
            border: 1px solid rgb(51, 51, 64);
            background: rgb(9, 9, 16);
            padding: 0.3em;
            padding-right: 2em;
        }`,
        /*css*/`
        ${SELECTOR_BUTTON_BREAK_PARENT} {
            display: grid;
            width: fit-content;
            grid-template-rows: repeat(auto-fit, minmax(0px, 0px));
        }`,
        /*css*/`
        ${SELECTOR_BUTTON_BREAK}, ${SELECTOR_BUTTON_RESUME} {
            background: rgb(42, 42, 54);
            color: inherit;
            padding: 0.55em 0.7em 0.5em 0.7em;
            margin: 0.5em;
            width: 100%;
            height: fit-content;
        }`,
    ];
};

const gui_str = (starts, stars, breaks, resumes) => {
    let diffs = starts.map((start,i) => {
        return (stars[i] || Date.now()) - start;
    });
    let parts = starts.map((start,i) => {
        // `starts.map` ensures start is defined, but not the 'zipped' values.
        let star = stars[i]; // likely undefined
        let diff = diffs[i]; // likely NaN

        let start_timestamp = date_formatted(new Date(start));

        let star_timestamp = "In Progress";
        if (star !== undefined) {
            star_timestamp = date_formatted(new Date(star));
        } else {
            diff = Date.now() - start;
        }
        let duration = time_formatted(diff);

        let breaks = [];
        let str = /*html*/`
            <table>
                <tr><td><span>Part ${i+1}:</span></td></tr>
                <tr><td style="line-height: 0; padding-bottom: 0.5em;"><span>${' -'.repeat(4)}</span></td></tr>
                <tr><td><span>Start: </span></td><td><span>${start_timestamp}</span></td></tr>
                <tr><td><span>End: </span></td><td><span>${star_timestamp}</span></td></tr>
            </table>
            <div>
                <span>${' -'.repeat(8)}</span>
            </div>
            <div>
                <span>Duration: </span><span ${star === undefined ? `class="${SELECTOR_IN_PROGRESS.slice(1)}"` : ''}>${duration}</span>
            </div>
        `;

        return str;
    });

    let sum = diffs.reduce((acc, n) => acc + n, 0);
    let total = time_formatted(sum);
    
    // `starts.length == stars.length` should only hold true when user completed the day.
    let complete = starts.length === stars.length;

    let wrap_stars = str => `<span class="${SELECTOR_STAR_COUNT.slice(1)}">* </span>${str}<span class="${SELECTOR_STAR_COUNT.slice(1)}"> *</span>`;
    let state = complete ? 'Complete!' : 'In Progress';
    state = `<span>${state}</span>`;
    state = complete ? wrap_stars(state) : state;

    let str = /*html*/`
        <div class="${SELECTOR_TIMEKEEPING.slice(1)}">
            <div class="${SELECTOR_TIMEKEEPING_INNER.slice(1)}">
                <div>
                    ${parts.join('')}
                </div>
                <div>
                    <span>${'='.repeat(16)}</span>
                </div>
                <div>
                    <span>Status: </span>${state}
                </div>
                <div>
                    <span>Total: </span><span class="${SELECTOR_TOTAL_IN_PROGRESS.slice(1)}">${total}</span>
                </div>
            </div>
            <div class="${SELECTOR_BUTTON_BREAK_PARENT.slice(1)}">
                <button class="${SELECTOR_BUTTON_BREAK.slice(1)}">Start Break!</button>
                <button class="${SELECTOR_BUTTON_RESUME.slice(1)}">Unbreak.</button>
            </div>
        </div>
    `;

    return str;
};


const day_gui = (year, day) => {
    let days = STORED_TIMEKEEPING[year] = (STORED_TIMEKEEPING[year] || {});
    let timestamps = days[day] = (days[day] || {});
    let starts = timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []);
    let stars = timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []);
    let breaks = timestamps[KEY_BREAKS] = (timestamps[KEY_BREAKS] || []);
    let resumes = timestamps[KEY_RESUMES] = (timestamps[KEY_RESUMES] || []);

    let str = gui_str(starts, stars);

    let sheet = document.styleSheets[1];
    gui_css_str().forEach(rule => sheet.insertRule(rule, sheet.cssRules.length));

    document.querySelector(SELECTOR_SIDEBAR).insertAdjacentHTML("afterEnd", str);

    let _ = setInterval(() => {
        let diffs = starts.map((start,i) => {
            return stars[i] || Date.now() - start;
        });
        document.querySelectorAll(SELECTOR_IN_PROGRESS).forEach((el, i) => {
            let duration = time_formatted(diffs[i]);
            el.innerHTML = duration;
        });
        document.querySelectorAll(SELECTOR_TOTAL_IN_PROGRESS).forEach(el => {
            let sum = diffs.reduce((acc, n) => acc + n, 0);
            let total = time_formatted(sum);
            el.innerHTML = total;
        });
    }, 1000);

    let button_break = document.querySelector(SELECTOR_BUTTON_BREAK);
    let button_resume = document.querySelector(SELECTOR_BUTTON_RESUME);

    let on_break = breaks.length > resumes.length;
    set_visible(button_break, !on_break);
    set_visible(button_resume, on_break);

    button_break.addEventListener("click", (e) => {
        console.log(`BUTTON>BREAK: Storing break-log.`);
        breaks.push( Date.now() );
        let on_break = breaks.length > resumes.length;
        set_visible(button_break, !on_break);
        set_visible(button_resume, on_break);
        set_stored_json(KEY_TIMEKEEPING, STORED_TIMEKEEPING);
    });
    button_resume.addEventListener("click", (e) => {
        console.log(`BUTTON>RESUME: Storing resume-log.`);
        resumes.push( Date.now() );
        let on_break = breaks.length > resumes.length;
        set_visible(button_break, !on_break);
        set_visible(button_resume, on_break);
        set_stored_json(KEY_TIMEKEEPING, STORED_TIMEKEEPING);
    });
};


//#region entry-point

const main = () => {
    console.log("PRE_SUPER DEBUG:\n", { ...STORED_TIMEKEEPING });
    // local storage already retrieved

    // check domain for triggers (opened question; gave answer)
    let trigger_start = location.href.match(aoc_trigger_start_regex);
    let trigger_end = location.href.match(aoc_trigger_end_regex);
    let stats = location.href.match(aoc_stats_regex);

    // opened question
    if (trigger_start !== null) {
        let year = parseInt(trigger_start[1], 10);
        let day = parseInt(trigger_start[2], 10);

        let days = STORED_TIMEKEEPING[year] = (STORED_TIMEKEEPING[year] || {});
        let timestamps = days[day] = (days[day] || {});

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
            console.log(`TRIGGER>START>RESUMING: Storing resume log is not automatic.`);
            // let resume = timestamps[KEY_RESUMES] = timestamps[KEY_RESUMES] || [];
            // resume.push( Date.now() );
        }

        day_gui(year, day);

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

        set_stored_json(KEY_TIMEKEEPING, STORED_TIMEKEEPING);
    }

    // stats
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
                let day = pre.match(re_day)[1];
                let parts = line.slice(pre.length).match(re_parts);
    
                let timestamps = days[day];
                if (timestamps === undefined) {
                    console.log(`[WARNING] LEADERBOARD> Warn(Code: 1): User has statistic for untracked day = ${day}`);
                    timestamps = days[day] = {};
                }
                
                let starts = timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []);
                let stars = timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []);

                if (starts.length < stars.length) { // Error instead?
                    console.log(`[WARNING] LEADERBOARD> Warn(Code: 2): User somehow has more stars than starts.`);
                    days = STORED_TIMEKEEPING[year] = {};
                }
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