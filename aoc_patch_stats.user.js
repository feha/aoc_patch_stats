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

//#region Enums
const STORAGE_SYNC_MODE = {}
// User has to manually trigger a write to storage.
STORAGE_SYNC_MODE.MANUAL= 1 << 0;
// setting an index in storage writes to persistent storage:
// storage[foo] = foobar
STORAGE_SYNC_MODE.AUTO_PROXY= 1 << 2;
// setting an index in storage (recursively for nested objects) writes to persistent storage:
// storage[foo][bar] = foobar
STORAGE_SYNC_MODE.RECURSE_AUTO_PROXY= 1 << 3 | STORAGE_SYNC_MODE.AUTO_PROXY; //! broken
const STORAGE_API_STRATEGY = {
    USE_GM: 'GM.*',
    USE_LOCALSTORAGE: 'LOCALSTORAGE',
    NONE: 'none',
};
// TODO Add "BroadcastChannel" strategy (pretty much same as postMEssage: `new BroadcastChannel('test_channel').postMessage(somestr)`)
// TODO  Main difference is that BroadcastChannel is same-origin, meaning other tabs and windows (on other domains) can't listen to it.
// TODO consider adding "sessionstorage" strategy (pretty much same as "localstorage", will in some browsers (ie chrome) not work at all, and others only work per-window)
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
const STORAGE_GET_KEY = Symbol('get');
const STORAGE_SET_KEY = Symbol('set');
const STORAGE_GETSTORAGEKEYS_KEY = Symbol('get_keys');
const STORAGE_LASTMODIFIED_KEY = 'storage_last_modified'; // As this is meant to be stored in storage, it can't be a Symbol
const STORAGE_PREFIX = `${GM.info.script.name}_`;
const STORAGE_BROADCASTCHANNEL = `${STORAGE_PREFIX}_broadcastchannel`;
const STORAGE_SYNC_INTERVAL = 60000; // 60 seconds

const PARTS_PER_DAY = 2;

const SELECTOR_TIMEKEEPING = ".timekeeping";
const SELECTOR_TIMEKEEPING_INNER = SELECTOR_TIMEKEEPING + "-inner";
const SELECTOR_STATUS = ".status";
const SELECTOR_IN_PROGRESS = ".in-progress";
const SELECTOR_TOTAL_IN_PROGRESS = ".total-in-progress";
const SELECTOR_BREAK_IN_PROGRESS = ".break-in-progress";
const SELECTOR_BREAK_TOTAL_IN_PROGRESS = ".break-total-in-progress";
const SELECTOR_BREAK_TOTAL_TOTAL_IN_PROGRESS = ".break-total-total-in-progress";
const SELECTOR_IN_PROGRESS_BREAKS = ".in-progress-breaks";
const SELECTOR_BREAKS = ".breaks";
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
    const v = await GM.getValue(key, "{}");
    return JSON.parse(v);
}
let set_stored_json = async (key, json) => {
    // window.localStorage.setItem(key, JSON.stringify(json));
    return GM.setValue(key, JSON.stringify(json));
}


/**
 * Initializes the storage mechanism based on availability.
 * Uses GM.setValue/GM.getValue or localStorage.
 * Handles synchronization between multiple tabs.
 * @returns {Object} Storage object using setter and getter to hide usage of cache- and api-usage.
 * Also allows access to internal cache, get, set, and get_keys properties using the appropriate Symbol()'s.
 */
function initialize_storage(sync_mode, notify_callback) {
    
    // TODO consider making the utility methods be closure, capturing values like api_strategy, or storage, to lower amount of arguments

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
    // TODO consider not having default values here.
    function storage_get_value_in_storage(api_strategy, key, default_value) {
        switch (api_strategy) {
            case STORAGE_API_STRATEGY.USE_GM:
                try {
                    return GM.getValue(key, default_value).then(value => parse_json_value(value));
                } catch (error) {
                    console.error(`Error getting value with GM.getValue: ${error}`);
                    return Promise.reject(error);
                }
            case STORAGE_API_STRATEGY.USE_LOCALSTORAGE:
                // use a prefix for localstorage, to avoid conflicts
                const prefixed_key = `${STORAGE_PREFIX}${key}`;
                value = localStorage.getItem(prefixed_key);
                // TODO Should instead check if key exists in localstorage. So "undefined", "null" and "false", etc. can be stored.
                value = value ? parse_json_value(value) : default_value;
                return Promise.resolve(value);
            default:
                return Promise.reject(new Error('Error: No storage-api strategy selected, but still tried to get value in storage.'));
        }
    }
    // TODO move last_modified updating + notify_ over here?
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
                return Promise.reject(new Error('Error: No storage-api strategy selected, but still tried to set value in storage.'));
        }
    }
    function storage_set_value_in_storage(api_strategy, notify_strategy, key, old_value, value) {
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
    function storage_get_value(api_strategy, storage, key, default_value) {
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

    function storage_mutation_callback(key, old_value, value) {
        // save data to persistent storage (if one exists)
        if (api_strategy != STORAGE_API_STRATEGY.NONE) {
            storage_set_value_in_storage(api_strategy, notify_strategy, key, old_value, value);
        }
    }
    
    function storage_set_value(sync_mode, api_strategy, notify_strategy, storage, key, value) {
        const old_value = storage[key];
        
        // always update cache, no matter which strategy
        storage.cache[key] = value;

        if (sync_mode & STORAGE_SYNC_MODE.AUTO_PROXY != 0) {
            storage_mutation_callback(api_strategy, notify_strategy, key, old_value, value);
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
    function sync_cache(api_strategy, storage) {
        return storage.get_keys()
            .then(keys => {
                return Promise.all(
                    keys.map(key => {
                        return storage_get_value_in_storage(api_strategy, key, undefined)
                            .then((value) => {
                                console.log("sync_cache", key, value);
                                sync_object_keeping_refs(storage.cache, {[key]: value}, key);
                            })
                    })
                );
            });
    }

    function sync_storage(storage) {
        Object.keys(storage.cache).forEach(key => {
            const old_value = undefined; // TODO an additional cache that was last seen in storage?
            const value = storage.cache[key];
            storage_mutation_callback(key, old_value, value);
        });
    }

    function notify_tabs(api_strategy, notify_strategy, key, old_value, value) {
        if (api_strategy != STORAGE_API_STRATEGY.NONE && notify_strategy == STORAGE_NOTIFY_STRATEGY.NONE) {
            // TODO ERROR and warn the user that storage can't be synced between tabs, and that they can overwrite each other
        }

        switch (api_strategy) {
            case STORAGE_API_STRATEGY.USE_GM:
                switch (notify_strategy) {
                    case STORAGE_NOTIFY_STRATEGY.BROADCASTCHANNEL:
                        const bc = new BroadcastChannel(STORAGE_BROADCASTCHANNEL);
                        bc.postMessage({ key, old_value, value });
                        console.log("posted");
                        break;
                    case STORAGE_NOTIFY_STRATEGY.GM_LISTENER:
                        // An event is dispatched automatically by GM.setValue, no need to do it ourselves
                        break;
                    case STORAGE_NOTIFY_STRATEGY.POSTMESSAGE:
                        // TODO any message sent is afaik visible to ALL  other scripts, in ALL windows.
                        // TODO  might not want to send data (and instead only send a notif that it should read changes from storage),
                        // TODO  or encrypt data before sending (as the key will be public in repo, this would be only be minor obfuscation).
                        // TODO Same code for both strategies, maybe change to not use nested switch-statements?
                        window.postMessage({ key, old_value, value }, window.location.origin);
                        break;
                    case STORAGE_NOTIFY_STRATEGY.LOCALSTORAGE:
                        // TODO use localstorage somehow to trigger "storage" event artificially
                        break;
                    default:
                        // Already handled
                        break;
                }
                break;
            case STORAGE_API_STRATEGY.USE_LOCALSTORAGE:
                switch (notify_strategy) {
                    case STORAGE_NOTIFY_STRATEGY.BROADCASTCHANNEL: // TODO duplication. maybe not use nested switch case?
                        const bc = new BroadcastChannel(STORAGE_BROADCASTCHANNEL);
                        bc.postMessage({ key, old_value, value });
                        console.log("posted2");
                        break;
                    case STORAGE_NOTIFY_STRATEGY.GM_LISTENER:
                        // TODO use GM.addValueChangeListener somehow to trigger "storage" event artificially
                        break;
                    case STORAGE_NOTIFY_STRATEGY.POSTMESSAGE:
                        window.postMessage({ key, old_value, value }, window.location.origin);
                        break;
                    case STORAGE_NOTIFY_STRATEGY.LOCALSTORAGE:
                        // An event is dispatched automatically by localstorage, no need to do it ourselves
                        break;
                    default:
                        // Already handled
                        break;
                }
                break;
            default:
                // Handle the case where no strategy has been selected.
                // Which in this case means do nothing (there's no storage to notify about).
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
                console.log("listen")
                listener_id = bc.addEventListener('message', (event) => {
                    console.log("received", event)
                    const { key, oldValue, newValue } = event.data;
                    listener(key, oldValue, newValue, true); // postMessage only triggers other tab
                });
                break;
            case STORAGE_NOTIFY_STRATEGY.GM_LISTENER:
                // TODO change "savedTab" to a listener for every key
                // TODO look into how this listener handles deleted keys, or cleared storage
                listener_id = GM.addValueChangeListener("savedTab", function(key, oldValue, newValue, remote) {
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
                    // TODO likely not going to be this simple. ie. might want to store all data in a single object in localstorage.
                    // TODO  then it's not as easy to know which value was changed as the changed key points at the entire object.
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
        storage_get_value_in_storage(api_strategy, STORAGE_LASTMODIFIED_KEY)
            .then(currentModified => {
                const lastModified = storage.cache[STORAGE_LASTMODIFIED_KEY] || 0;
                if (currentModified === undefined || currentModified > lastModified) {
                    // Update last modification timestamp in cache
                    storage.cache[STORAGE_LASTMODIFIED_KEY] = currentModified; // consider //? old comment?
                    // Update last modification timestamp in storage
                    storage_set_value_in_storage(api_strategy, notify_strategy, key, lastModified, currentModified);
                    
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
            sync: () => storage.sync,
            ...storage,
        };
        return storage_hide_internals;
    }

    function storage_create_proxy(storage_hide_internals, recursive_mutation_callback) {
        // Do not forward the internal symbols. Allows to ie. explicitly index value in storage.cache
        const internals = [
            ...Object.keys(storage_hide_internals),
            ...Object.getOwnPropertySymbols(storage_hide_internals)
        ];
        console.log(internals)

        let as_obj_or_proxy = (obj) => obj;
        if (typeof recursive_mutation_callback !== 'undefined' && typeof recursive_mutation_callback === 'function') {
            console.log("recursive_mutation_callback")
            as_obj_or_proxy = (obj, proxy, key) => {
                const set_callback = () => {
                    // guard against the key having been reassigned and the callback was from an old value
                    if (proxy[key] === obj) {
                        recursive_mutation_callback(key, undefined, obj)
                    }
                };
                return create_recursive_proxy(set_callback, obj);
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
        const proxy = new Proxy(storage_hide_internals, {
            get: function(target, prop) {
                console.log("get", prop)
                if (internals.includes(prop)) {
                    console.log("internals", prop)
                    return target[prop];
                }
                let value = target[STORAGE_GET_KEY](prop);
                value = as_obj_or_proxy(value, proxy, prop);
                // call .storage_get_value
                return value;
            },
            set: function(target, prop, value) {
                if (internals.includes(prop)) {
                    target[prop] = value;
                    return true;
                }
                value = as_obj_or_proxy(value, proxy, prop);
                // call .storage_set_value
                target[STORAGE_SET_KEY](prop, value);
                return true;
            },
        });
        
        return proxy;
    }

    function create_recursive_proxy(set_callback, obj) {
        console.log("create_recursive_proxy")
        if (typeof obj === 'object') {
            // proxy future values
            obj = new Proxy(obj, {
                get: function(target, prop) {
                    let value = target[prop];
                    value = create_recursive_proxy(set_callback, value);
                    return value;
                },
                set: function(target, prop, value) {
                    if (target[prop] !== value) {
                        target[prop] = create_recursive_proxy(set_callback, value);
                        set_callback(); // notify storage
                    }
                    return true;
                },
            });
        }
        
        return obj;
    }

    const storage = {};
    storage.cache = {};

    const exists_GM = typeof GM !== 'undefined' && typeof GM.setValue !== 'undefined' && typeof GM.getValue !== 'undefined';
    const exists_GM_Listener = exists_GM && typeof GM.addValueChangeListener !== 'undefined';
    const exists_localstorage = typeof localStorage !== 'undefined'

    // strategy for which api to handle persistent data with
    let api_strategy = STORAGE_API_STRATEGY.NONE
    // Use GM.setValue and GM.getValue if available
    if (exists_GM) {
        api_strategy = STORAGE_API_STRATEGY.USE_GM;
    }
    // Fall back to localStorage
    if (!exists_GM && exists_localstorage) {
        api_strategy = STORAGE_API_STRATEGY.USE_LOCALSTORAGE;
    }

    if (api_strategy == STORAGE_API_STRATEGY.NONE) {
        // Warn if neither option is available
        console.error('LocalStorage and GM.setValue/GM.getValue are not available, unable to load/store data. Using temporary cache for now');
    }

    // strategy for notifying tabs
    let notify_strategy = STORAGE_NOTIFY_STRATEGY.BROADCASTCHANNEL
    // if (exists_GM_Listener) {
    //     notify_strategy = STORAGE_NOTIFY_STRATEGY.GM_LISTENER
    // }

    // Get all keys in storage
    storage.get_keys = function () {
        return storage_get_keys(api_strategy, storage);
    };
    // getter and setter that hides away implementation strategies from user
    storage.get = function(key, default_value) {
        return storage_get_value(api_strategy, storage, key, default_value);
    };
    storage.set = function(key, value) {
        console.log("set:", key);
        return storage_set_value(sync_mode, api_strategy, notify_strategy, storage, key, value);
    };
    storage.sync = function() {
        sync_storage(storage);
    };


    // Initialize the cache with current contents of storage
    const syncing = sync_cache(api_strategy, storage)
        .then(() => {
            let exposed_storage = storage;
            if (sync_mode & STORAGE_SYNC_MODE.AUTO_PROXY) {
                exposed_storage = storage_hide_internals(storage);
                let mutation_callback;
                if (sync_mode == STORAGE_SYNC_MODE.RECURSE_AUTO_PROXY) {
                    mutation_callback = (key, old_value, value) => storage_mutation_callback(api_strategy, notify_strategy, key, old_value, value)
                }
                // Return a proxy for the storage object
                exposed_storage = storage_create_proxy(exposed_storage, mutation_callback);    
            } else {
                exposed_storage = {...exposed_storage};
            }
            return exposed_storage;
        });
    
    // Listen for storage changes
    const storage_listener = (key, old_value, new_value, remote) => {
        if (remote === undefined || remote) {
            // update all
            sync_cache(api_strategy, storage)
                .then(() => {
                    // Notify user that storage was mutated by remote
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
    
    return syncing;
}


const notify_callback = () => {
    
    
    // TODO invalidate and redraw gui (always? if needed? Easier to always do it)
    // TODO sync_cache is an async promise
};


const sync_mode = STORAGE_SYNC_MODE.MANUAL;
const storage = await initialize_storage(sync_mode, notify_callback);
// TODO make a callback for when storage has mutated (at least from other tabs),
// TODO the gui can then listen to this to invalidate itself.

console.log("storage",storage);

let STORED_TIMEKEEPING;
if (sync_mode & ~STORAGE_SYNC_MODE.AUTO_PROXY) {
    STORED_TIMEKEEPING = storage.get(KEY_TIMEKEEPING, {});
} else {
    STORED_TIMEKEEPING = storage[KEY_TIMEKEEPING] = storage[KEY_TIMEKEEPING] || {};
}
console.log("stored_timekeeping",STORED_TIMEKEEPING);

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
const call_listeners = (key) => {
    listeners[key].forEach(f => f(key));
}

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

const gui_break_str = (start, star, breaks, resumes) => {
    let on_break = breaks.length > resumes.length;

    let breaks_diff = breaks.map((n, i) => (resumes[i] || Date.now()) - n);
    let breaks_diff_formatted = breaks.map((n, i) => time_formatted((resumes[i] || Date.now()) - n, true, 2));

    let entries = breaks.map((n, i) => {
        let in_progress = resumes[i] === undefined ? `class="${SELECTOR_BREAK_IN_PROGRESS.slice(1)}" data-since="${n}"` : '';

        return `<tr><td class="td-right"><span ${in_progress}>${breaks_diff_formatted[i]}</span> : </td><td>${date_formatted(new Date(n))}</td></tr>`;
    }).join('');

    let dynamic_breaks = star !== undefined ? '' : `data-since="${start}" class="${SELECTOR_IN_PROGRESS_BREAKS}"`

    let sum = breaks_diff.reduce((acc, n) => acc + n, 0);
    let total = time_formatted(sum);

    let str = /*html*/`
        Breaks: <span ${on_break ? `class="${SELECTOR_BREAK_TOTAL_IN_PROGRESS.slice(1)}"` : ''} data-since="${start}" data-star="${star || ''}">${total}</span>
        <details>
            <summary></summary>
            <table ${dynamic_breaks}>
                ${entries}
            </table>
        </details>
    `;

    return str;
}

const gui_str = (starts, stars, breaks, resumes) => {
    let diffs = starts.map((start,i) => {
        return (stars[i] || Date.now()) - start;
    });
    let parts = starts.map((start,i) => {
        // `starts.map` ensures start is defined, but not the 'zipped' values.
        let star = stars[i]; // likely undefined
        let diff = diffs[i]; // likely NaN

        // Filter out breaks not in current part.
        // Undefined behaviour when user claims to have a star inbetween a breaks start and stop.
        // Because the script stops any ongoing break when receiving a star,
        // this should never happen without something like manually edited logs anyway.
        let breaks_filtered = breaks
                .filter(n => start <= n && (!star || n <= star));
        let resumes_filtered = resumes
                .filter(n => start <= n && (!star || n <= star));
        
        let no_breaks = breaks_filtered.length == 0;

        let start_timestamp = date_formatted(new Date(start));

        let star_timestamp = "In Progress";
        if (star !== undefined) {
            star_timestamp = date_formatted(new Date(star));
        } else {
            diff = Date.now() - start;
        }
        let duration = time_formatted(diff);

        let str = /*html*/`
            <table>
                <tr><td><span>Part ${i+1}:</span></td></tr>
                <tr><td style="line-height: 0; padding-bottom: 0.5em;"><span>${' -'.repeat(4)}</span></td></tr>
                <tr><td><span>Start: </span></td><td><span>${start_timestamp}</span></td></tr>
                <tr  ${no_breaks ? 'hidden' : ''}><td colspan = 2>
                    <div class="${SELECTOR_BREAKS.slice(1)}">
                        ${gui_break_str(start, star, breaks_filtered, resumes_filtered)}
                    </div>
                </td></tr>
                <tr><td><span>End: </span></td><td><span>${star_timestamp}</span></td></tr>
            </table>
            <div>
                <span>${' -'.repeat(8)}</span>
            </div>
            <div>
                <span>Duration: </span><span ${star === undefined ? `class="${SELECTOR_IN_PROGRESS.slice(1)}" data-since="${start}"` : ''}>${duration}</span>
            </div>
        `;

        return str;
    });


    let no_breaks = breaks.length == 0;
    let on_break = breaks.length > resumes.length;
    let break_diffs = breaks.map((n, i) => (resumes[i] || Date.now()) - n );
    let sum_breaks = break_diffs.reduce((acc, n) => acc + n, 0);
    let total_break = time_formatted(sum_breaks);

    let sum = diffs.reduce((acc, n) => acc + n, 0) - sum_breaks;
    let total = time_formatted(sum);
    
    // `starts.length == stars.length` should only hold true when user completed the day.
    let complete = starts.length === stars.length;

    let status = complete ? 'Complete!' : on_break ? 'On Break...' : 'In Progress';
    status = `<span>${status}</span>`;
    status = complete ? wrap_stars(status) : status;

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

    return str;
};


const day_gui = (year, day) => {
    let days = STORED_TIMEKEEPING[year] = (STORED_TIMEKEEPING[year] || {});
    let timestamps = days[day] = (days[day] || {});
    let starts = timestamps[KEY_STARTS] = (timestamps[KEY_STARTS] || []);
    let stars = timestamps[KEY_STARS] = (timestamps[KEY_STARS] || []);
    let breaks = timestamps[KEY_BREAKS] = (timestamps[KEY_BREAKS] || []);
    let resumes = timestamps[KEY_RESUMES] = (timestamps[KEY_RESUMES] || []);
    
    // filter break logs, such that it's within [first start .. (last star if complete)]
    let filtered_breaks = breaks
            .filter(n => Math.min(...starts) <= n && (stars.length < 2 || n <= Math.max(...stars)));
    let filtered_resumes = resumes
            .filter(n => Math.min(...starts) <= n && (stars.length < 2 || n <= Math.max(...stars)));

    let str = gui_str(starts, stars, filtered_breaks, filtered_resumes);

    let sheet = document.styleSheets[1];
    gui_css_str().forEach(rule => sheet.insertRule(rule, sheet.cssRules.length));

    document.querySelector(SELECTOR_SIDEBAR).insertAdjacentHTML("afterEnd", str);


    // ui refresh loop
    let _ = setInterval(() => {
        let diffs = starts.map((start,i) => (stars[i] || Date.now()) - start );
        document.querySelectorAll(SELECTOR_IN_PROGRESS).forEach((el, i) => {
            let since = el.getAttribute("data-since");
            let duration = time_formatted(Date.now() - since);
            // let duration = time_formatted(diffs[i]);
            el.textContent = duration;
        });
        document.querySelectorAll(SELECTOR_TOTAL_IN_PROGRESS).forEach(el => {
            let break_diffs = filtered_breaks.map((n, i) => (filtered_resumes[i] || Date.now()) - n );
            let sum_breaks = break_diffs.reduce((acc, n) => acc + n, 0);
            let sum = diffs.reduce((acc, n) => acc + n, 0) - sum_breaks;
            let total = time_formatted(sum);
            el.textContent = total;
        });

        document.querySelectorAll(SELECTOR_BREAK_IN_PROGRESS).forEach((el) => {
            let since = el.getAttribute("data-since");
            let duration = time_formatted(Date.now() - since);
            el.textContent = duration;
        });
        document.querySelectorAll(SELECTOR_BREAK_TOTAL_IN_PROGRESS).forEach((el) => {
            let since = el.getAttribute("data-since");
            let star = el.getAttribute("data-star") || Date.now();
            let filtered_filtered_resumes = filtered_resumes
                    .filter(n => since <= n && n <= star)
            let breaks_diff = filtered_breaks
                    .filter(n => since <= n && n <= star)
                    .map((n, i) => (filtered_filtered_resumes[i] || Date.now()) - n);
            
            let sum = breaks_diff.reduce((acc, n) => acc + n, 0);
            let total = time_formatted(sum, true, 2);

            el.textContent = total;
        });
        document.querySelectorAll(SELECTOR_BREAK_TOTAL_TOTAL_IN_PROGRESS).forEach(el => {
            let break_diffs = filtered_breaks.map((n, i) => (filtered_resumes[i] || Date.now()) - n );
            let sum = break_diffs.reduce((acc, n) => acc + n, 0);
            let total = time_formatted(sum);
            el.textContent = total;
        });
    }, 1000);

    let divs_breaks = document.querySelectorAll(SELECTOR_BREAKS);
    let button_break = document.querySelector(SELECTOR_BUTTON_BREAK);
    let button_resume = document.querySelector(SELECTOR_BUTTON_RESUME);

    let on_break = filtered_breaks.length > filtered_resumes.length;
    set_visible(button_break, !on_break);
    set_visible(button_resume, on_break);

    const button_break_func = () => {
        // `starts.length == stars.length` should only hold true when user completed the day.
        let complete = starts.length === stars.length;
        let on_break = filtered_breaks.length > filtered_resumes.length;

        set_visible(button_break, !on_break);
        set_visible(button_resume, on_break);

        call_listeners(KEY_BREAKS, update_breaks);
        call_listeners(KEY_RESUMES, update_breaks);

        storage.sync();
        // set_stored_json(KEY_TIMEKEEPING, STORED_TIMEKEEPING);

        document.querySelectorAll(SELECTOR_STATUS).forEach(el => {
            let status = complete ? 'Complete!' : on_break ? 'On Break...' : 'In Progress';
            status = `<span>${status}</span>`;
            status = complete ? wrap_stars(status) : status;

            el.innerHTML = status;
        });
    };

    const update_breaks = () => {
        divs_breaks.forEach((el, i) => {
            let start = starts[i];
            let star = stars[i]; // likely undefined
            let filtered_filtered_breaks = filtered_breaks
                    .filter(n => start <= n && (!star || n <= star));
            let filtered_filtered_resumes = filtered_resumes
                    .filter(n => start <= n && (!star || n <= star));
            el.innerHTML = gui_break_str(start, star, filtered_filtered_breaks, filtered_filtered_resumes);
        })
    }

    button_break.addEventListener("click", (e) => {
        // `starts.length == stars.length` should only hold true when user completed the day.
        let complete = starts.length === stars.length;
        if (complete) {
            console.log(`[WARNING] BUTTON>RESUME> Warn(Code: 0): Already Complete, no reason to 'leak' peristent memory.`);

            let old = button_break.textContent;
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

        storage.sync();
        // set_stored_json(KEY_TIMEKEEPING, { ...STORED_TIMEKEEPING }); // TODO why clone? Should be unneeded.
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
 
        storage.sync();
        // set_stored_json(KEY_TIMEKEEPING, STORED_TIMEKEEPING);
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
                let breaks = timestamps[KEY_BREAKS] = (timestamps[KEY_BREAKS] || []);
                let resumes = timestamps[KEY_RESUMES] = (timestamps[KEY_RESUMES] || []);

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

    console.log("SUPER DEBUG:\n", STORED_TIMEKEEPING);
};
main();

console.log("aoc_patch_times finished!");

})();
// });