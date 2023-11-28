// ==UserScript==
// @name         aoc_patch_stats
// @icon         https://adventofcode.com/favicon.png
// @namespace    
// @version      0.1
// @description  Patches the bug in AoC where their timekeeping accidentally stores time since questions release, rather than time since user started the question.
// @author       F
// @match https://adventofcode.com/*
// @match https://adventofcode.com*
// @grant       GM.listValues
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM.addValueChangeListener
// @grant       GM_getTab
// @grant       GM.addStyle
// @noframes
//// @run-at document_end
// ==/UserScript==

// TODO Make persistent data somehow get stored attached to your AoC account.
//      Doesn't seem possible: there's no field to store data in aside from the
//       actual timestamp for each star - and that is time-diff since question
//       was released, so you have little control over its value.
//      Not to mention how using it would collide with using the site normally...

// TODO fix storage in proxy mode. There are a couple issues with using proxies:
// TODO they seem to try to index promises ".then" for some reason
// TODO and bunch of other stuff

// TODO cleanup logs
// TODO ie. broadcastchannel

// TODO clean up todo's and comments

console.log("aoc_patch_times readied");
// const script = (function(jnode) {
(async function() {
    'use strict';

console.log("aoc_patch_times start!");

//#region Enums
const STORAGE_SYNC_MODE = {}
// User has to manually trigger a write to storage.
STORAGE_SYNC_MODE.MANUAL= 1 << 0;
// setting an index in storage writes to persistent storage:
// storage[foo] = foobar
STORAGE_SYNC_MODE.AUTO_PROXY= 1 << 1;
// setting an index in storage (recursively for nested objects) writes to persistent storage:
// storage[foo][bar] = foobar
STORAGE_SYNC_MODE.RECURSE_AUTO_PROXY= 1 << 2 | STORAGE_SYNC_MODE.AUTO_PROXY; //! broken
const STORAGE_API_STRATEGY = {
    USE_GM: 'GM.*',
    USE_LOCALSTORAGE: 'LOCALSTORAGE',
    NONE: 'none',
};
const STORAGE_NOTIFY_STRATEGY = {
    BROADCASTCHANNEL: 'BroadcastChannel',
    GM_LISTENER: 'GM.addValueChangeListener',
    POSTMESSAGE: 'postmessage',
    LOCALSTORAGE: 'localstorage',
    NONE: 'none',
};
//#endregion


//#region Settings/constants/templates

const STORAGE_CACHE_KEY = Symbol('cache');
const STORAGE_GETSTORAGEKEYS_KEY = Symbol('get_keys');
const STORAGE_GET_KEY = Symbol('get');
const STORAGE_SET_KEY = Symbol('set');
const STORAGE_SYNC_KEY = Symbol('sync');
const STORAGE_RECURSIVE_PROXY_KEY = Symbol('recurse_proxy');
const STORAGE_LASTMODIFIED_KEY = 'storage_last_modified'; // As this is meant to be stored in storage, it can't be a Symbol
const STORAGE_PREFIX = `${GM.info.script.name}_`;
const STORAGE_BROADCASTCHANNEL = `${STORAGE_PREFIX}broadcastchannel`;
const STORAGE_UNIQUE_TAB = crypto.randomUUID();
const STORAGE_SYNC_INTERVAL = 60000; // 60 seconds

const PARTS_PER_DAY = 2;

const SELECTOR_TIMEKEEPING = ".timekeeping";
const SELECTOR_TIMEKEEPING_INNER = SELECTOR_TIMEKEEPING + "-inner";
const SELECTOR_PART_START = ".part-start";
const SELECTOR_PART_END = ".part-end";
const SELECTOR_STATUS = ".status";
const SELECTOR_IN_PROGRESS = ".in-progress";
const SELECTOR_TOTAL_IN_PROGRESS = ".total-in-progress";
const SELECTOR_BREAK_IN_PROGRESS = ".break-in-progress";
const SELECTOR_BREAK_TOTAL_IN_PROGRESS = ".break-total-in-progress";
const SELECTOR_BREAK_TOTAL_TOTAL_IN_PROGRESS = ".break-total-total-in-progress";
const SELECTOR_IN_PROGRESS_BREAKS = ".in-progress-breaks";
const SELECTOR_BREAKS = ".breaks";
const SELECTOR_BREAKS_ACTIVE = ".breaks:not([hidden])";
const SELECTOR_BUTTON_BREAK_PARENT = ".button-parent";
const SELECTOR_BUTTON_BREAK = ".button-break";
const SELECTOR_BUTTON_RESUME = ".button-resume";
const SELECTOR_STAR_COUNT = ".star-count"
const SELECTOR_QUESTION = ".day-desc";
const SELECTOR_SUCCESS = ".day-success";
const SELECTOR_SUCCESS_STAR_COUNTER = "p";
const SELECTOR_SIDEBAR = "#sidebar";

const ATTR_DATA_START = "data-start";
const ATTR_DATA_END = "data-end";
const ATTR_DATA_SINCE = "data-since";
const ATTR_DATA_STAR = "data-star";

const KEY_TIMEKEEPING = SELECTOR_TIMEKEEPING.slice(1);
const KEY_STARTS = "starts";
const KEY_STARS = "stars";
const KEY_BREAKS = "breaks";
const KEY_RESUMES = "resumes";

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


//#region Storage utils

/**
 * Initializes the storage mechanism based on availability.
 * Uses GM.setValue/GM.getValue or localStorage.
 * Handles synchronization between multiple tabs.
 * @returns {Object} Storage object, or a proxy (hiding any usage of cache- and api-usage) if sync_mode is not MANUAL.
 * Also allows access to internal cache, get, set, and get_keys properties using the appropriate Symbol()'s.
 */
function initialize_storage(sync_mode, api_strategy, notify_strategy, notify_callback) {
    function parse_json_value(value, default_value) {
        try {
            return JSON.parse(value) || default_value;
        } catch (error) {
            if (error instanceof SyntaxError) {
                console.error('Error parsing JSON:', error);
                return default_value;
            } else {
                throw error;
            }
        }
    }
    
    function storage_get_keys(api_strategy, storage) {
        switch (api_strategy) {
            case STORAGE_API_STRATEGY.USE_GM:
                return GM.listValues();
            case STORAGE_API_STRATEGY.USE_LOCALSTORAGE:
                // emulate GM.* with returning a promise
                return Promise.resolve(Object.keys(localStorage));
            default:
                // Handle the case where no strategy has been selected.
                // Which in this case means returning cache keys.
                // emulate GM.* with returning a promise
                return Promise.resolve(Object.keys(storage.cache));
        }
    }

    // getter and setter that returns a getter and setter for desired api.
    function storage_get_api(api_strategy) {
        switch (api_strategy) {
            case STORAGE_API_STRATEGY.USE_GM:
                return (key, default_value) => {
                    try {
                        // we can't know if it returned value or default_value,
                        //  so can't tell when to parse and as such always parses.
                        // So prepare default value for being parsed.
                        const json_str = JSON.stringify(default_value);
                        return GM.getValue(key, json_str)
                            .then(value => value !== undefined ? parse_json_value(value) : default_value);
                    } catch (error) {
                        console.error(`Error getting value with GM.getValue: ${error}`);
                        return Promise.reject(error);
                    }
                }
            case STORAGE_API_STRATEGY.USE_LOCALSTORAGE:
                return (key, default_value) => {
                    // use a prefix for localstorage, to avoid conflicts
                    const prefixed_key = `${STORAGE_PREFIX}${key}`;
                    value = localStorage.getItem(prefixed_key);
                    value = value ? parse_json_value(value) : default_value;
                    return Promise.resolve(value);
                }
            default:
                return () => Promise.reject(new Error('Error: No storage-api strategy selected, but still tried to set value in storage.'));
        }
    }
    function storage_set_api(api_strategy) {
        switch (api_strategy) {
            case STORAGE_API_STRATEGY.USE_GM:
                return (key, value) => GM.setValue(key, value);
            case STORAGE_API_STRATEGY.USE_LOCALSTORAGE:
                return (key, value) => {
                    const prefixed_key = `${STORAGE_PREFIX}${key}`; // use a prefix for localstorage, to avoid conflicts
                    try {
                        localStorage.setItem(prefixed_key, json_str)
                        return Promise.resolve(); // emulate how GM.setValue returns empty promises.
                    } catch (error) {
                        console.error(`Error setting value with localStorage: ${error}`);
                        return Promise.reject(error);
                    }
                }
            default:
                return () => Promise.reject(new Error('Error: No storage-api strategy selected, but still tried to set value in storage.'));
        }
    }
    // getter and setter that hides away implementation strategies through a closure
    function storage_get_value_in_storage(key, default_value) {
        return storage_get_api(api_strategy)(key, default_value);
    }
    function storage_set_value_in_storage(key, old_value, value) {
        console.log("storage_set_value_in_storage", key, old_value, value)
        const json_str = JSON.stringify(value);
        return storage_set_api(api_strategy)(key, json_str)
            .then(() => {
                // notify other tabs that storage has been updated.
                notify_tabs(api_strategy, notify_strategy, key, old_value, value);
                // update modification timestamp.
                storage_set_api(api_strategy)(STORAGE_LASTMODIFIED_KEY, Date.now())
                    .then(() => {
                        // notify other tabs that storage has been updated.
                        notify_tabs(api_strategy, notify_strategy, key, old_value, value);
                    });
            });
    }

    // getter and setter for the storage object (handles syncing both cache and persistent storage)
    function storage_get_value(storage, key, default_value) {
        if (storage.cache.hasOwnProperty(key)) {
            return storage.cache[key] = storage.cache[key] || default_value;
        } else {
            // As GM.getValue is asynchronous, but this method is meant to be synchronous,
            //  we can't try to get the value from storage here.
            // But that is ok as the cache is kept up-to-date with storage_set_value and the notify_listener (and initialized with storage contents),
            //  meaning cache should never be out of sync with storage anyway.
            // Instead, if value is not in cache, we simply assume it's not in storage at all.
            return default_value;

            // // Handle the case where no strategy has been selected.
            // // Which in this case means returning default value, as cache is empty.
            // if (api_strategy == STORAGE_API_STRATEGY.NONE) {
            //     return Promise.resolve(default_value);
            // }
            // // Get value from storage.
            // const value_promise = storage_get_value_from_storage(api_strategy, key, default_value)
            //     .then(stored_value => {
            //         const value = parse_json_value(stored_value, default_value)
            //         // update cache
            //         storage.cache[key] = value;
            //         return value;
            //     });
            // return value_promise;
        }
    }
    function storage_set_value(sync_mode, storage, key, value) {
        const old_value = storage[key];
        
        // always update cache, no matter which strategy
        storage.cache[key] = value;

        if (sync_mode & STORAGE_SYNC_MODE.AUTO_PROXY) {
            storage_mutation_callback(key, old_value, value);
        }
    }

    function storage_mutation_callback(key, old_value, value) {
        // save data to persistent storage (if one exists)
        if (api_strategy != STORAGE_API_STRATEGY.NONE) {
            storage_set_value_in_storage(key, old_value, value);
        }
    }

    function sync_object_keeping_refs(obj1, obj2, key) {
        // As user might have references to nested objects in storage.cache,
        //  when updating the cache object (or any of the nested ones) we can't just replace it entirely.
        // Instead we want to only update the _changes_ between the values:
        //  assign value if it was a primitive type (because no pointer can get disconnected anyway, no need to bother with equality).
        //  delete old keys that has been removed.
        //  assign new keys that didn't exist yet.
        //  recursively do this for key-conflicts.
        const old_value = obj1[key];
        const new_value = obj2[key];
        if (typeof old_value === 'object' && typeof new_value === 'object' ) {
            Object.keys(old_value)
                .forEach(old_key => {
                    if (old_key in new_value) {
                        // union is detected twice, ignore once.
                    } else {
                        // remove nonexistent keys 
                        delete old_value[old_key];
                    }
                });
            Object.keys(new_value)
                .forEach(new_key => {
                    if (new_key in old_value) {
                        // recursively sync the objects 
                        sync_object_keeping_refs(old_value, new_value, new_key);
                    } else {
                        // add unassigned keys
                        old_value[new_key] = new_value;
                    }
                });
        } else {
            // replace primitives, no need to bother with equality-checks
            obj1[key] = new_value;
        }
    }
    function sync_cache(storage) {
        return storage.get_keys()
            .then(keys => {
                return Promise.all(
                    keys.map(key => {
                        return storage_get_value_in_storage(key, undefined)
                            .then((value) => {
                                sync_object_keeping_refs(storage.cache, {[key]: value}, key);
                            })
                    })
                );
            });
    }

    function sync_storage(storage) {
        Object.keys(storage.cache).forEach(key => {
            const old_value = undefined;
            const value = storage.cache[key];
            storage_mutation_callback(key, old_value, value);
        });
    }

    function notify_tabs(api_strategy, notify_strategy, key, old_value, value) {
        if (api_strategy != STORAGE_API_STRATEGY.NONE && notify_strategy == STORAGE_NOTIFY_STRATEGY.NONE) {
            // TODO ERROR and warn the user that storage can't be synced between tabs,
            // TODO  and that they can therefor overwrite each other
        }
        switch (notify_strategy) {
            case STORAGE_NOTIFY_STRATEGY.BROADCASTCHANNEL:
                const remote = STORAGE_UNIQUE_TAB;
                const bc = new BroadcastChannel(STORAGE_BROADCASTCHANNEL);
                bc.postMessage({ remote, key });
                // bc.postMessage({ remote, key, old_value, value });
                console.log("posted notification");
                break;
            case STORAGE_NOTIFY_STRATEGY.GM_LISTENER:
                if (api_strategy == STORAGE_API_STRATEGY.USE_GM) {
                    // An event is dispatched automatically by GM.setValue, no need to do it ourselves
                } else {
                    // TODO use GM.addValueChangeListener somehow to trigger "storage" event artificially
                }
                break;
            case STORAGE_NOTIFY_STRATEGY.POSTMESSAGE:
                // TODO any message sent is afaik visible to ALL  other scripts, in ALL windows.
                // TODO  might not want to send data (and instead only send a notif that it should read changes from storage),
                // TODO  or encrypt data before sending (as the key will be public in repo, this would be only be minor obfuscation).
                // TODO Same code for both strategies, maybe change to not use nested switch-statements?
                window.postMessage({ key, old_value, value }, window.location.origin);
                break;
            case STORAGE_NOTIFY_STRATEGY.LOCALSTORAGE:
                if (api_strategy == STORAGE_API_STRATEGY.USE_LOCALSTORAGE) {
                    // An event is dispatched automatically by localstorage, no need to do it ourselves
                } else {
                    // TODO use localstorage somehow to trigger "storage" event artificially
                }
                break;
            default:
                // Already handled
                break;
        }
    }

    function listen_notify(notify_strategy, listener) {
        // Since notify_tabs aims for the notif to be identical regardless of storage_api, the receiver only cares for notify_strategy.
        let listener_id;
        switch (notify_strategy) {
            case STORAGE_NOTIFY_STRATEGY.BROADCASTCHANNEL:
                // Listen for messages from other tabs
                const bc = new BroadcastChannel(STORAGE_BROADCASTCHANNEL);
                listener_id = bc.addEventListener('message', (event) => {
                    // const { remote, key } = event.data;
                    const { remote, key, oldValue, newValue } = event.data;
                    listener(key, oldValue, newValue, remote != STORAGE_UNIQUE_TAB); // postMessage only triggers other tab
                });
                break;
            case STORAGE_NOTIFY_STRATEGY.GM_LISTENER:
                // TODO change "savedTab" to a listener for every key
                // TODO look into how this listener handles deleted keys, or cleared storage
                // TODO ALTERNATIVELY use last_modified key and sync everything
                listener_id = GM.addValueChangeListener(STORAGE_LASTMODIFIED_KEY, function(key, oldValue, newValue, remote) {
                    listener(key, oldValue, newValue, remote)
                });
                break;
            case STORAGE_NOTIFY_STRATEGY.POSTMESSAGE:
                // Listen for messages from other tabs
                listener_id = window.addEventListener('message', (event) => {
                    // filter to only see messages from this script
                    if (event.origin === window.location.origin) {
                        const { key, oldValue, newValue } = event.data;
                        listener(key, oldValue, newValue, true); // postMessage only triggers other tab
                    }
                });
                break;
            case STORAGE_NOTIFY_STRATEGY.LOCALSTORAGE:
                // Listen for changes in storage from other tabs
                listener_id = window.addEventListener("storage", function (event) {
                    const key = event.key
                    const oldValue = event.oldValue
                    const newValue = event.newValue
                    listener(key, oldValue, newValue)
                });
                break;
            default:
                // TODO do a WARNING
                break;
        }
        return listener_id;
    }
    function listen_interval(storage, listener, all=true) {
        storage_get_value_in_storage(STORAGE_LASTMODIFIED_KEY)
            .then(currentModified => {
                const lastModified = storage.cache[STORAGE_LASTMODIFIED_KEY] || 0;
                if (currentModified === undefined || currentModified > lastModified) {
                    // Update last modification timestamp in cache
                    storage.cache[STORAGE_LASTMODIFIED_KEY] = currentModified;
                    
                    // Storage has changed, trigger the listener function
                    if (all) {
                        listener();
                    } else {
                        // TODO call listener for EVERY key?
                        // TODO call listener for changed keys?
                    }
                }
            });
    }

    function storage_hide_internals(storage) {
        // Create a proxy-object that forwards indexing to STORAGE_GET_KEY and STORAGE_SET_KEY methods.
        // TODO consider making this more generic where the mapping is passed as an argument
        const storage_hide_internals = {
            [STORAGE_CACHE_KEY]: storage.cache,
            [STORAGE_GET_KEY]: storage.get,
            [STORAGE_SET_KEY]: storage.set,
            [STORAGE_GETSTORAGEKEYS_KEY]: storage.get_keys,
            [STORAGE_SYNC_KEY]: () => storage.sync,
        };
        return storage_hide_internals;
    }

    function storage_create_proxy(obj, recursive_mutation_callback) {
        // // identifier to be able to know object is a proxy, so we don't wrap proxies
        // obj[STORAGE_RECURSIVE_PROXY_KEY] = true;

        // Do not forward the internal symbols. Allows to ie. explicitly index value in storage.cache
        const internals = [
            ...Object.keys(obj),
            ...Object.getOwnPropertySymbols(obj)
        ];
        let proxy;

        let as_obj_or_proxy = (obj2) => obj2;
        if (typeof recursive_mutation_callback !== 'undefined' && typeof recursive_mutation_callback === 'function') {
            as_obj_or_proxy = (obj2, key, target) => {
                let obj_as_proxy = obj2;
                const set_callback = () => {
                    //! gets a new proxy object each time, wont work
                    if (proxy[key] === obj2 || proxy[key] === obj_as_proxy) {
                        recursive_mutation_callback(key, undefined, obj_as_proxy)
                    }
                };
                obj_as_proxy = create_recursive_proxy(set_callback, obj2); // need to update "obj" to the proxy, as Proxy(obj) !== obj
                return obj_as_proxy;
            }
        }
        // if (typeof propagate !== 'undefined') {
        //     // callback that re-triggers the setter for this key
        //     const set_callback = () => {
        //         // guard against the key having been reassigned and the callback was from an old value
        //         if (proxy[prop] === value) {
        //             // proxy[prop] = value;
        //             target[STORAGE_SET_KEY](prop, value);
        //         }
        //     };
        //     value = create_recursive_proxy(set_callback, value);
        // }
        const handler = {
            get: function(target, prop) {
                if (internals.includes(prop)) {
                    return target[prop];
                }
                let value = target[STORAGE_GET_KEY](prop);
                value = as_obj_or_proxy(value, prop, target);
                target[STORAGE_SET_KEY](prop, value);
                // call .storage_get_value
                return value;
            },
            set: function(target, prop, value) {
                if (internals.includes(prop)) {
                    target[prop] = value;
                    return true;
                }
                // value = as_obj_or_proxy(value, prop);
                // call .storage_set_value
                target[STORAGE_SET_KEY](prop, value);
                return true;
            },
        };
        proxy = new Proxy(obj, handler);
        
        return proxy;
    }

    function create_recursive_proxy(set_callback, obj) {
        if (typeof obj === 'object') {
            if (obj[STORAGE_RECURSIVE_PROXY_KEY]) {
                // Already a proxy, don't wrap
                return obj;
            } else {
                // Create a proxy that proxies future values in this object, recursively
                const internals = [
                    STORAGE_RECURSIVE_PROXY_KEY,
                ];

                const handler = {
                    get: function(target, prop) {
                        if (internals.includes(prop)) {
                            return handler[prop];
                        }
                        let value = target[prop];
                        value = create_recursive_proxy(set_callback, value);
                        return value;
                    },
                    set: function(target, prop, value) {
                        if (internals.includes(prop)) {
                            handler[prop] = value;
                            return true;
                        }
                        if (target[prop] !== value) {
                            // value = create_recursive_proxy(set_callback, value);
                            target[prop] = value;
                            set_callback(); // notify storage
                        }
                        return true;
                    },
                    // identifier to be able to know object is already a proxy, to avoid proxying the proxy.
                    [STORAGE_RECURSIVE_PROXY_KEY]: true,
                };
                obj = new Proxy(obj, handler);
            }
        }
        
        return obj;
    }
    
    if (api_strategy == STORAGE_API_STRATEGY.NONE) {
        // Warn if neither option is available
        console.error('[WARNING] LocalStorage and GM.setValue/GM.getValue are not available, unable to load/store data. Using temporary cache for now');
    }

    const storage = {};
    storage.cache = {};

    // Get all keys in storage
    storage.get_keys = function () {
        return storage_get_keys(api_strategy, storage);
    };
    storage.get = function(key, default_value) {
        return storage_get_value(storage, key, default_value);
    };
    storage.set = function(key, value) {
        return storage_set_value(sync_mode, storage, key, value);
    };
    storage.sync = function() {
        sync_storage(storage);
    };


    // Initialize the cache with current contents of storage
    const syncing = sync_cache(storage)
        .then(() => {
            let exposed_storage = storage;
            if (sync_mode & STORAGE_SYNC_MODE.AUTO_PROXY) {
                exposed_storage = storage_hide_internals(storage);
                let mutation_callback;
                if (sync_mode == STORAGE_SYNC_MODE.RECURSE_AUTO_PROXY) {
                    mutation_callback = (key, old_value, value) => storage_mutation_callback(key, old_value, value)
                }
                // Return a proxy for the storage object
                exposed_storage = storage_create_proxy(exposed_storage, mutation_callback);    
            } else {
                exposed_storage = {...exposed_storage};
            }
            return exposed_storage;
        });
    
    // Listen for storage changes, if there's an api-strategy
    if (api_strategy != STORAGE_API_STRATEGY.NONE) {
        const storage_listener = (key, old_value, new_value, remote) => {
            if (remote === undefined || remote) {
                // update all
                sync_cache(storage)
                    .then(() => {
                        // Notify user that storage was mutated by remote
                        console.log("received notification")
                        notify_callback();
                    });
                // // update only changed key
                // const value = JSON.parse(new_value);
                // storage.cache[key] = value;
            }
        };
            
        listen_notify(notify_strategy, storage_listener);
    
        // setInterval strategy. Always fallbacks on this just-in-case there's some undetected issue
        setInterval(() => {
            listen_interval(storage, storage_listener);
        }, STORAGE_SYNC_INTERVAL);
    }
    
    return syncing;
}

//#endregion


//#region Helpers

const unique = (arr) => [...new Set(arr)];

const set_visible = (e, visible) => visible ? e.setAttribute('style', '') : e.setAttribute('style', 'visibility: hidden;');
// const set_visible = (e, visible) => visible ? e.removeAttribute('hidden') : e.setAttribute('hidden', '');

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
const time_formatted = (diff, add_units = true, min_size) => {
    if (diff < 1000) { // just return the milliseconds if diff < 1 second
        return diff + (add_units && " ms");
    }

    const format = ["yyyy", "mm", "dd", "hh", "mm", "ss", "000"];
    const delim = ":";
    // add_units = add_units && ["h", "m", "s"] || [];

    let [duration, units] = time_length(diff, format);
    if (duration !== undefined) {
        duration = duration.slice(0, -1); // Remove ms

        let idx = duration.findIndex(n => n != 0);
        idx = min_size ? Math.min(idx, duration.length-min_size) : idx;


        if (add_units) {
            duration = duration.map((s,i) => s + units[i].short);
        }
        duration = duration
            .filter((_, i) => i >= idx) // remove front-trailing zeroes
            .join(delim);
    }
    
    return duration;
}
// dates formatted for the timekeeping ui
const date_formatted = (date, units, only_differences) => {
    const date_delim = "-";
    const middle_delim = "::";
    const clock_delim = ":";
    const units_short = ["Y", "M", "d", "h", "m", "s", "ms"];
    
    units = units ? (() => {
        let t = typeof units;
        switch (t) {
            case "array":
                return units;
            case "string":
                return units_short.map(u => units.split('').find(c => c == u) ? u : '');
            default:
                return units_short;
        }
    })() : Array(units_short.length).fill('');
    
    let fs = [
        d=>d.getUTCFullYear(),
        d=>d.getUTCMonth()+1,
        d=>d.getUTCDate(),
        d=>d.getUTCHours(),
        d=>d.getUTCMinutes(),
        d=>d.getUTCSeconds(),
        d=>d.getUTCMilliseconds(),
    ];
    date = fs.map(f => f(date))
            .map((n,i) => (""+n).padStart(2, '0')+units[i]);

    if (only_differences) {
        let d2 = only_differences;
        d2 = fs.map(f => f(d2))
                .map((n,i) => (""+n).padStart(2, '0')+units[i]);
        let idx = date.findIndex((s,i) => s != d2[i]);
        date = date.filter((_, i) => i >= idx);
    }

    let clock =  date.slice(-4).slice(0,-1);
    date = date.slice(0, -4);
    
    date = ''
            + date.join(date_delim)
            + middle_delim
            + clock.join(clock_delim);
    
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

let wrap_stars = str => `<span class="${SELECTOR_STAR_COUNT.slice(1)}">* </span>${str}<span class="${SELECTOR_STAR_COUNT.slice(1)}"> *</span>`;

let listeners = {};
const add_listener = (key, f) => {
    listeners[key] = listeners[key] || [];
    listeners[key].push(f);
}
const remove_listener = (key, f) => {
    listeners[key] = listeners[key] || [];
    listeners[key] = listeners[key].filter(f2 => f !== f2);
}
const call_listeners = (key) => {
    listeners[key].forEach(f => f(key));
}

//#endregion


//#region gui

const gui_css_str = () => {
    return [
        /*css*/`
        .hidden {
            visibility: hidden;
        }`,
        /*css*/`
        #${GM.info.script.name}-sidebar {
            float: right;
            clear: right;
            margin: 0 15px 2em 2em;
            position: relative;
            z-index: 10;
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
        /*css*/`
        details summary:after {
            vertical-align: top;
            content: "...";
        }`,
        /*css*/`
        details[open] summary:after {
            content: "";
        }`,
        /*css*/`
        details>summary {/* Remove default triangle */
            list-style: none;
        }`,
        /*css*/`
        summary::-webkit-details-marker /* Safari */ {
            display: none
        }`,
        /*css*/`
        summary:before { /* Add a better triangle */
            content: ' ';
            display: inline-block;
            
            border-top: 5px solid transparent;
            border-bottom: 5px solid transparent;
            border-left: 5px solid currentColor;
            
            margin-right: .7rem;
            transform: translateY(-2px);
            
            transition: transform .2s ease-out; /* animate */
        }`,
        /*css*/`
        details[open] summary:before {
            transform: rotate(90deg) translateX(-3px);
        }`,
        /*css*/`
        .td-right {
            text-align: right;
        }`,
    ];
};


const gui_str_break_item = (break_t, break_diff_formatted, resume_t) => {
    const in_progress = resume_t === undefined ? `class="${SELECTOR_BREAK_IN_PROGRESS.slice(1)}" ${ATTR_DATA_SINCE}="${break_t}"` : '';

    return /*html*/`
        <tr>
            <td class="td-right">
                <span ${in_progress}>
                    ${break_diff_formatted}
                </span>
                :
            </td>
            <td>
                ${date_formatted(new Date(break_t))}
            </td>
        </tr>
    `;
};

const gui_str_break_list = (start, star, breaks, resumes, open) => {
    const dynamic_breaks = star == undefined ? `${ATTR_DATA_SINCE}="${start}" class="${SELECTOR_IN_PROGRESS_BREAKS}"` : '';
    
    const entries = breaks
        .map((n, i) =>
                gui_str_break_item(
                    n,
                    time_formatted((resumes[i] || Date.now()) - n, true, 2),
                    resumes[i],
                )
            )
        .join('');

    return /*html*/`
        <details ${open ? 'open' : ''}>
            <summary></summary>
            <table ${dynamic_breaks}>
                ${entries}
            </table>
        </details>
    `;
};

const state_parts=[];
const gui_str_part = (part, start, star, breaks, resumes) => {
    // `start` is ensured to be defined, but not any of the other fields.

    // // `starts.map` ensures start is defined, but not the 'zipped' values.
    // let star = star; // likely undefined
    let diff = (star || Date.now()) - start; // likely NaN

    // Filter out breaks not in current part.
    // Undefined behaviour when user claims to have a star inbetween a breaks start and stop.
    // Because the script stops any ongoing break when receiving a star,
    // this should never happen without something like manually edited logs anyway.
    const breaks_filtered = breaks
            .filter(n => start <= n && (!star || n <= star));
    const resumes_filtered = resumes
            .filter(n => start <= n && (!star || n <= star));
    
    const no_breaks = breaks_filtered.length == 0;

    const start_timestamp = date_formatted(new Date(start));

    let star_timestamp = "In Progress";
    if (star !== undefined) {
        star_timestamp = date_formatted(new Date(star));
    } else {
        diff = Date.now() - start;
    }
    const duration = time_formatted(diff);

    const on_break = breaks.length > resumes.length;
    const breaks_diff = breaks.map((n, i) => (resumes[i] || Date.now()) - n);
    const sum = breaks_diff.reduce((acc, n) => acc + n, 0);
    const total = time_formatted(sum);
    const open = (state_parts[part] = state_parts[part] || {}).open;

    return /*html*/`
        <table>
            <tr><td><span>Part ${part}:</span></td></tr>
            <tr><td style="line-height: 0; padding-bottom: 0.5em;"><span>
                ${' -'.repeat(4)}
            </span></td></tr>
            <tr>
                <td><span>
                    Start: 
                </span></td>
                <td><span class="${SELECTOR_PART_START.slice(1)}" ${ATTR_DATA_START}="${start}">
                    ${start_timestamp}
                </span></td>
            </tr>
            <tr  ${no_breaks ? 'hidden' : ''}>
                <td colspan = 2>
                    <div class="${SELECTOR_BREAKS.slice(1)}">
                        Breaks:
                        <span ${on_break ? `class="${SELECTOR_BREAK_TOTAL_IN_PROGRESS.slice(1)}"` : ''} ${ATTR_DATA_SINCE}="${start}" ${ATTR_DATA_STAR}="${star || ''}">
                            ${total}
                        </span>
                        <div>
                            ${gui_str_break_list(start, star, breaks_filtered, resumes_filtered, open)}
                        </div>
                    </div>
                </td>
            </tr>
            <tr>
                <td><span>
                    End: 
                </span></td>
                <td><span class="${SELECTOR_PART_END.slice(1)}" ${ATTR_DATA_END}="${star || ''}">
                    ${star_timestamp}
                </span></td>
            </tr>
        </table>
        <div>
            <span>${' -'.repeat(8)}</span>
        </div>
        <div>
            <span>Duration: </span>
            <span ${star === undefined ? `class="${SELECTOR_IN_PROGRESS.slice(1)}" ${ATTR_DATA_SINCE}="${start}"` : ''}>
                ${duration}
            </span>
        </div>
    `;
};
const gui_str_sidebar = (starts, stars, breaks, resumes) => {
    const diffs = starts
        .map((start,i) => (stars[i] || Date.now()) - start);

    const parts = starts
        .map((start,i) => gui_str_part(i, start, stars[i], breaks, resumes));

    const no_breaks = breaks.length == 0;
    const on_break = breaks.length > resumes.length;
    const break_diffs = breaks.map((n, i) => (resumes[i] || Date.now()) - n );
    const sum_breaks = break_diffs.reduce((acc, n) => acc + n, 0);
    const total_break = time_formatted(sum_breaks);

    const sum = diffs.reduce((acc, n) => acc + n, 0) - sum_breaks;
    const total = time_formatted(sum);
    
    // `starts.length == stars.length` should only hold true when user completed the day.
    const complete = starts.length === stars.length;

    let status = complete ? 'Complete!' : on_break ? 'On Break...' : 'In Progress';
    status = `<span>${status}</span>`;
    status = complete ? wrap_stars(status) : status;

    return /*html*/`
        <div class="${SELECTOR_TIMEKEEPING.slice(1)}">
            <div class="${SELECTOR_TIMEKEEPING_INNER.slice(1)}">
                <div>
                    ${parts.join('')}
                </div>
                <div>
                    <span>${'='.repeat(16)}</span>
                </div>
                <div>
                    <span>Status: </span><span class="${SELECTOR_STATUS.slice(1)}">${status}</span>
                </div>
                <div style="color: #888" ${no_breaks ? 'hidden' : ''}>
                    <span>Breaks: </span><span class="${SELECTOR_BREAK_TOTAL_TOTAL_IN_PROGRESS.slice(1)}">${total_break}</span>
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
};


let display_interval, update_breaks;
const day_gui = (year, day, clear = false) => {
    let container;
    if (clear) {
        const container_id = `${GM.info.script.name}-sidebar`;
        container = document.querySelector(`#${container_id}`);
        container.parentNode.removeChild(container);

        clearInterval(display_interval);
        remove_listener(KEY_BREAKS, update_breaks);
        remove_listener(KEY_RESUMES, update_breaks);
    }

    const sidebar = document.querySelector(SELECTOR_SIDEBAR);
    const container_id = `${GM.info.script.name}-sidebar`;
    sidebar.insertAdjacentHTML("afterEnd", `<div id="${container_id}"></div>`);
    container = document.querySelector(`#${container_id}`);

    let days = (STORED_TIMEKEEPING[year] = (STORED_TIMEKEEPING[year] || {}), STORED_TIMEKEEPING[year]);
    let timestamps = (days[day] = (days[day] || {}), days[day]);
    let starts = (timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []), timestamps[KEY_STARTS]);
    let stars = (timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []), timestamps[KEY_STARS]);
    let breaks = (timestamps[KEY_BREAKS] = (timestamps[KEY_BREAKS] || []), timestamps[KEY_BREAKS]);
    let resumes = (timestamps[KEY_RESUMES] = (timestamps[KEY_RESUMES] || []), timestamps[KEY_RESUMES]);
    // let days = STORED_TIMEKEEPING[year] = (STORED_TIMEKEEPING[year] || {});
    // let timestamps = days[day] = (days[day] || {});
    // let starts = timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []);
    // let stars = timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []);
    // let breaks = timestamps[KEY_BREAKS] = (timestamps[KEY_BREAKS] || []);
    // let resumes = timestamps[KEY_RESUMES] = (timestamps[KEY_RESUMES] || []);
    
    // filter break logs, such that it's within [first start .. (last star if complete)]
    let filtered_breaks = breaks
            .filter(n => Math.min(...starts) <= n && (stars.length < 2 || n <= Math.max(...stars)));
    let filtered_resumes = resumes
            .filter(n => Math.min(...starts) <= n && (stars.length < 2 || n <= Math.max(...stars)));


    // Apply CSS
    gui_css_str().forEach(rule => GM.addStyle(rule));
    // let sheet = document.styleSheets[1];
    // gui_css_str().forEach(rule => sheet.insertRule(rule, sheet.cssRules.length));

    // create gui
    let str = gui_str_sidebar(starts, stars, filtered_breaks, filtered_resumes);
    container.insertAdjacentHTML("beforeEnd", str);

    
    [...container.querySelectorAll("details")]
        .map((el, i) => {
            el.addEventListener("toggle", () => {
                state_parts[i].open = el.hasAttribute("open");
            });
        });


    // ui refresh loop
    // TODO clean on redraw
    display_interval = setInterval(() => {
        const starts = [...container.querySelectorAll(SELECTOR_PART_START)]
            .map(el => el.getAttribute(ATTR_DATA_START));
        const stars = [...container.querySelectorAll(SELECTOR_PART_END)]
            .map(el => el.getAttribute(ATTR_DATA_END));
        const diffs = starts
            .map((start,i) => (stars[i] || Date.now()) - start );
        
        container.querySelectorAll(SELECTOR_IN_PROGRESS).forEach((el, i) => {
            const since = el.getAttribute(ATTR_DATA_SINCE);
            const duration = time_formatted(Date.now() - since);
            // const duration = time_formatted(diffs[i]);
            el.textContent = duration;
        });
        container.querySelectorAll(SELECTOR_TOTAL_IN_PROGRESS).forEach(el => {
            const break_diffs = filtered_breaks.map((n, i) => (filtered_resumes[i] || Date.now()) - n );
            const sum_breaks = break_diffs.reduce((acc, n) => acc + n, 0);
            const sum = diffs.reduce((acc, n) => acc + n, 0) - sum_breaks;
            const total = time_formatted(sum);
            el.textContent = total;
        });

        container.querySelectorAll(SELECTOR_BREAK_IN_PROGRESS).forEach((el) => {
            const since = el.getAttribute(ATTR_DATA_SINCE);
            const duration = time_formatted(Date.now() - since);
            el.textContent = duration;
        });
        container.querySelectorAll(SELECTOR_BREAK_TOTAL_IN_PROGRESS).forEach((el,i) => {
            const since = starts[i];
            const star = stars[i] || Date.now();
            const filtered_filtered_resumes = filtered_resumes
                    .filter(n => since <= n && n <= star)
                    const breaks_diff = filtered_breaks
                    .filter(n => since <= n && n <= star)
                    .map((n, i) => (filtered_filtered_resumes[i] || Date.now()) - n);
            
                    const sum = breaks_diff.reduce((acc, n) => acc + n, 0);
                    const total = time_formatted(sum, true, 2);

            el.textContent = total;
        });
        container.querySelectorAll(SELECTOR_BREAK_TOTAL_TOTAL_IN_PROGRESS).forEach(el => {
            const break_diffs = filtered_breaks.map((n, i) => (filtered_resumes[i] || Date.now()) - n );
            const sum = break_diffs.reduce((acc, n) => acc + n, 0);
            const total = time_formatted(sum);
            el.textContent = total;
        });
    }, 1000);

    let divs_breaks = container.querySelectorAll(SELECTOR_BREAKS);
    let button_break = container.querySelector(SELECTOR_BUTTON_BREAK);
    let button_resume = container.querySelector(SELECTOR_BUTTON_RESUME);

    let on_break = filtered_breaks.length > filtered_resumes.length;
    set_visible(button_break, !on_break);
    set_visible(button_resume, on_break);

    const button_break_func = () => {
        // `starts.length == stars.length` should only hold true when user completed the day.
        const complete = starts.length === stars.length;
        const on_break = filtered_breaks.length > filtered_resumes.length;

        set_visible(button_break, !on_break);
        set_visible(button_resume, on_break);

        call_listeners(KEY_BREAKS);
        call_listeners(KEY_RESUMES);

        if (sync_mode & STORAGE_SYNC_MODE.MANUAL) {
            storage.sync();
        }

        container.querySelectorAll(SELECTOR_STATUS).forEach(el => {
            let status = complete ? 'Complete!' : on_break ? 'On Break...' : 'In Progress';
            status = `<span>${status}</span>`;
            status = complete ? wrap_stars(status) : status;

            el.innerHTML = status;
        });
    };

    update_breaks = () => {
        if (divs_breaks.length) {
            divs_breaks.forEach((el, i) => {
                const start = starts[i];
                const star = stars[i]; // likely undefined
                const filtered_filtered_breaks = filtered_breaks
                        .filter(n => start <= n && (!star || n <= star));
                const filtered_filtered_resumes = filtered_resumes
                        .filter(n => start <= n && (!star || n <= star));
                // el.innerHTML = gui_str_part(i, start, star, filtered_filtered_breaks, filtered_filtered_resumes);
                let list = el.querySelector("details").parentNode;
                list.innerHTML = gui_str_break_list(start, star, filtered_filtered_breaks, filtered_filtered_resumes, state_parts[i].open);

                list.querySelector("details").addEventListener("toggle", (ev) => {
                    state_parts[i].open = ev.target.hasAttribute("open");
                });

                // unhide list if it has contnets but is still hidden
                const row = el.parentNode.parentNode;
                if (filtered_filtered_breaks.length && row.hasAttribute("hidden")) {
                    row.removeAttribute("hidden");
                }
            })
        } else {
            console.error("TODO")
        }
    }

    button_break.addEventListener("click", (e) => {
        // `starts.length == stars.length` should only hold true when user completed the day.
        const complete = starts.length === stars.length;
        if (complete) {
            console.log(`[WARNING] BUTTON>RESUME> Warn(Code: 0): Already Complete, no reason to 'leak' peristent memory.`);

            const old = button_break.textContent;
            button_break.textContent = "Can't start break: Already Complete"
            button_break.setAttribute('disabled', '')
            setTimeout(() => {
                button_break.textContent = old;
            }, 2000);
            return; // abort
        }

        console.log(`BUTTON>BREAK: Storing break-log.`);
        breaks.push( Date.now() );
        // re-filter
        filtered_breaks = breaks
                .filter(n => Math.min(...starts) <= n && (stars.length < 2 || n <= Math.max(...stars)));

        button_break_func();
    });
    button_resume.addEventListener("click", (e) => {
        // `starts.length == stars.length` should only hold true when user completed the day.
        let complete = starts.length === stars.length;
        if (complete) {
            console.log(`[WARNING] BUTTON>RESUME> Warn(Code: 0): Somehow tried to end a break when finished. THIS SHOULD BE IMPOSSIBLE STATE!!!`);
            return; // abort
        }
        
        console.log(`BUTTON>RESUME: Storing resume-log.`);
        resumes.push( Date.now() );
        // re-filter
        filtered_resumes = resumes
                .filter(n => Math.min(...starts) <= n && (stars.length < 2 || n <= Math.max(...stars)));

        button_break_func();
    });
    add_listener(KEY_BREAKS, update_breaks);
    add_listener(KEY_RESUMES, update_breaks);
};

//#endregion

//#region init

const init_day = (year, day) => {
    // opened question
    let days = (STORED_TIMEKEEPING[year] = (STORED_TIMEKEEPING[year] || {}), STORED_TIMEKEEPING[year]);
    let timestamps = (days[day] = (days[day] || {}), days[day]);
    let starts = (timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []), timestamps[KEY_STARTS]);

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

    if (sync_mode & STORAGE_SYNC_MODE.MANUAL) {
        storage.sync();
    }
}
const init_answer_day = (year, day) => {
    // gave answer
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

    let stars = (timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []), timestamps[KEY_STARS]);
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

    if (sync_mode & STORAGE_SYNC_MODE.MANUAL) {
        storage.sync();
    }
}

const init_stats = (year) => {
    // stats
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
            
            let starts = (timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []), timestamps[KEY_STARTS]);;
            let stars = (timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []), timestamps[KEY_STARS]);;
            let breaks = (timestamps[KEY_BREAKS] = (timestamps[KEY_BREAKS] || []), timestamps[KEY_BREAKS]);;
            let resumes = (timestamps[KEY_RESUMES] = (timestamps[KEY_RESUMES] || []), timestamps[KEY_RESUMES]);

            if (starts.length < stars.length) { // Error instead?
                console.log(`[WARNING] LEADERBOARD> Warn(Code: 2): User somehow has more stars than starts.`);
            }
            // From the nature of the stats, no relevant start is without a star.
            let diffs = stars.map((end, i) => end - starts[i]);

            
            let parts_patched = parts.map((part, i) => {
                let start = starts[i];
                let star = stars[i];
                let diff = diffs[i];

                let part_patched = '';
                if (diff === undefined) {
                    part_patched = part.match(re_time).slice(1)
                            .map((cap, i) => {
                                if (i!==1) {
                                    return cap;
                                }
                                return cap === '-' ? cap.padStart(9, ' ') + ' ' : `'${cap.padStart(8, ' ')}'`;
                            })
                            .join('');

                } else {
                    // filter break logs such that they are within part's start and star (if complete).
                    let filtered_breaks = breaks
                        .filter(n => start <= n && (!star || n <= star));
                    let filtered_resumes = resumes
                        .filter(n => start <= n && (!star || n <= star));

                    // From the nature of the stats, no ongoing part is displayed.
                    // And from the nature of breaks, no break extend past a part in either direction.
                    // So we can assume all breaks has a resume, and don't need to handle a case where the resume is undefined.
                    let break_diffs = filtered_breaks.map((n, i) => filtered_resumes[i] - n );
                    let sum = break_diffs.reduce((acc, n) => acc + n, 0);

                    const format = ["yyyy", "mm", "dd", "hh", "mm", "ss", "000"];
                    const delim = ":";
                    const display_size = 3;
                    let [duration, units] = time_length(diff - sum, format);

                    let idx_limit = units.findIndex(unit => unit.short == "h");
                    idx_limit = Math.min(idx_limit, duration.length - display_size);
                    duration = duration
                            .filter((_,i) => i >= idx_limit)
                            .filter((_,i) => i < display_size)
                            .join(delim).padStart(9, ' ');
                    
                    part_patched = part.match(re_time).slice(1)
                            .map((cap, i) => i==1 ? duration + ' ' : cap )
                            .join('');
                }
                return part_patched;
            });
            
            return pre + parts_patched.join('');
        }
        ""
    }).join('\n');

    node.textContent = lines_patched;
}

const init_page = (trigger_start, trigger_end, stats, year, day) => {
    // opened question
    if (trigger_start !== null) {
        init_day(year, day);
    }

    // gave answer
    if (trigger_end !== null) {
        init_answer_day(year, day);
    }

    // stats
    if (stats !== null) {
        init_stats(year)
    }
}

//#endregion


//#region entry-point
let sync_mode, storage, STORED_TIMEKEEPING; // persistent data
const main = () => {
    // check domain for triggers (opened question; gave answer)
    let trigger_start = location.href.match(aoc_trigger_start_regex);
    let trigger_end = location.href.match(aoc_trigger_end_regex);
    let stats = location.href.match(aoc_stats_regex);

    // day, answer, or personal-stats webpage
    let year, day;
    let notify_callback
    if (trigger_start !== null || trigger_end !== null) {
        year = parseInt(trigger_start[1], 10);
        day = parseInt(trigger_start[2], 10);

        notify_callback = () => {
            day_gui(year, day, true);
        };
    } else if (stats !== null) {
        year = parseInt(stats[1], 10);

        notify_callback = () => {
            // No need to redraw personal stats page, as nothing there can (currently) write to storage anyway.
        };
    }

    // sync_mode = STORAGE_SYNC_MODE.RECURSE_AUTO_PROXY; //! broken
    sync_mode = STORAGE_SYNC_MODE.MANUAL;
    const exists_GM = typeof GM !== 'undefined' && typeof GM.setValue !== 'undefined' && typeof GM.getValue !== 'undefined';
    const exists_GM_Listener = exists_GM && typeof GM.addValueChangeListener !== 'undefined';
    const exists_localstorage = typeof localStorage !== 'undefined'

    // strategy for which api to handle persistent data with
    let api_strategy = STORAGE_API_STRATEGY.NONE;
    // Use GM.setValue and GM.getValue if available
    if (exists_GM) {
        api_strategy = STORAGE_API_STRATEGY.USE_GM;
    }
    // Fall back to localStorage
    if (!exists_GM && exists_localstorage) {
        api_strategy = STORAGE_API_STRATEGY.USE_LOCALSTORAGE;
    }


    // strategy for notifying tabs
    let notify_strategy = STORAGE_NOTIFY_STRATEGY.BROADCASTCHANNEL
    // if (exists_GM_Listener) {
    //     notify_strategy = STORAGE_NOTIFY_STRATEGY.GM_LISTENER
    // }
    initialize_storage(sync_mode, api_strategy, notify_strategy, notify_callback).then(data => {
        storage = data;
        
        if (sync_mode & STORAGE_SYNC_MODE.AUTO_PROXY) {
            // regular default assignments does not work with proxies, as they return rhs, not what the proxy's setter assigned.
            // STORED_TIMEKEEPING = storage[KEY_TIMEKEEPING] = (storage[KEY_TIMEKEEPING] || {});
            STORED_TIMEKEEPING = (storage[KEY_TIMEKEEPING] ?? (storage[KEY_TIMEKEEPING] = {}), storage[KEY_TIMEKEEPING]);
        } else {
            // STORED_TIMEKEEPING = storage.get(KEY_TIMEKEEPING, {}); // also works
            const obj = storage.cache;
            STORED_TIMEKEEPING = (obj[KEY_TIMEKEEPING] ?? (obj[KEY_TIMEKEEPING] = {}), obj[KEY_TIMEKEEPING]);
        }

        console.log("PRE_SUPER DEBUG:\n", STORED_TIMEKEEPING);

        init_page(trigger_start, trigger_end, stats, year, day)

        console.log("SUPER DEBUG:\n", STORED_TIMEKEEPING);
    });
};
main();

console.log("aoc_patch_times finished!");

})();
// });