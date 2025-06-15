// Config

const CACHE_TTL = 5 * 60 * 1000; // Cache Time-To-Live in milliseconds
const CONCURRENT_LIMIT = 4; // Max Parallel Fetch Requests

// ===

const baseURL = window.location.href
    .split(/(\/tasks)|(\/communication)|(\/documentation)|(\/testing)/)[0]
    .replace(/\/+$/g, "");
const user = document.querySelector("em")?.textContent;

function isCMSPage() {
    const hasCMSHeader = !!document.querySelector(".navbar");
    const hasUserElement = !!document.querySelector("em");
    // Fix Me : Add urlPattern
    // const urlPattern = /\/(description|submissions|communication|documentation|testing)(\/|$)/;
    return hasCMSHeader && hasUserElement && haveNavList;
}

const parser = new DOMParser();

let score = new Map();
let fullScore = new Map();
let responseCache = new Map();

async function loadStorageCache() {
    const storageCache = { count: 0 };
    try {
        const items = await chrome.storage.local.get();
        Object.assign(storageCache, items);
    } catch (e) {
        console.error("Error retrieving storage data");
    }

    storageCache.count++;
    chrome.storage.local.set(storageCache);

    const responseCacheKey = `${baseURL}_${user}_responseCache`;

    const data = await chrome.storage.local.get([responseCacheKey]);

    if (data[responseCacheKey]) {
        responseCache = new Map(Object.entries(data[responseCacheKey]));
        responseCache.forEach((value, key) => {
            score.set(key, value.score);
            fullScore.set(key, value.fullScore);
        });
    }
}

async function storeStorageCache() {
    const responseCacheKey = `${baseURL}_${user}_responseCache`;

    const object = new Object();
    object[responseCacheKey] = Object.fromEntries(responseCache);

    try {
        await chrome.storage.local.set(object);
    } catch (e) {
        if (e.message && e.message.includes("Extension context invalidated")) {
            return;
        }
        console.error("Failed to store data:", e);
    }
}

function calculateTotalScore() {
    let totalScore = 0;
    let totalFullScore = 0;

    score.forEach((value) => {
        totalScore += value;
    });

    fullScore.forEach((value) => {
        totalFullScore += value;
    });

    return { totalScore, totalFullScore };
}

function updateTotalScore() {
    const { totalScore, totalFullScore } = calculateTotalScore();
    const totalScoreElement = document.getElementById(
        "cms-extension-total-score"
    );
    if (totalScoreElement) {
        const percentage =
            totalFullScore > 0
                ? Math.round((totalScore / totalFullScore) * 100)
                : 0;
        totalScoreElement.textContent = `Total: ${totalScore} / ${totalFullScore} (${percentage}%)`;
    }
}

async function fetchAllScore(elements, force = false) {
    // gather task
    const tasks = [];
    Array.from(elements).forEach((element, i) => {
        if (element.classList.contains("nav-header")) {
            try {
                const task = (
                    element.querySelector("span") || element
                ).textContent.trim();
                const url = elements[i + 2]?.querySelector("a")?.href;
                if (url) {
                    if (force && responseCache.has(task)) {
                        responseCache.delete(task);
                    }
                    tasks.push({ element, task, url });
                }
            } catch (e) {
                console.error("Error fetching task:", e);
            }
        }
    });

    // throttle concurrent fetches
    let index = 0;
    const queue = Array(CONCURRENT_LIMIT).fill(Promise.resolve());
    for (const { element, task, url } of tasks) {
        const runner = async () => {
            const res = await fetchAndParseTask(url, task);
            if (res) {
                const { scoreValue, fullScoreValue } = res;
                score.set(task, scoreValue);
                fullScore.set(task, fullScoreValue);
                updateSidebarElement(element);
                updateTotalScore();
            }
            return res;
        };
        const slot = index % CONCURRENT_LIMIT;
        queue[slot] = queue[slot].then(runner);
        index++;
    }
    await Promise.all(queue);
}

async function fetchAndParseTask(url, task) {
    if (!url) return null;
    try {
        const now = Date.now();
        const cachedResponse = responseCache.get(task);
        let scoreValue, fullScoreValue;
        if (cachedResponse && now - cachedResponse.timestamp < CACHE_TTL) {
            scoreValue = cachedResponse.score;
            fullScoreValue = cachedResponse.fullScore;
        } else {
            const response = await fetch(url, { cache: "no-store" });
            const htmlContent = await response.text();
            const parsedHTML = parser.parseFromString(htmlContent, "text/html");
            const result = getScore(parsedHTML)
                .split("/")
                .map((val) => parseInt(val, 10));
            scoreValue = result[0];
            fullScoreValue = result[1];
            responseCache.set(task, {
                score: scoreValue,
                fullScore: fullScoreValue,
                timestamp: now,
            });
        }
        return { task, scoreValue, fullScoreValue };
    } catch (e) {
        console.error(`Error fetching task ${task}:`, e);
        return null;
    }
}

async function withButtonDisabled(asyncFn) {
    const button = document.querySelector(".refresh-button");
    if (!button) return;

    button.disabled = true;
    button.textContent = "Refreshing...";

    try {
        await asyncFn();
        // update last refreshed timestamp
        const lastEl = document.getElementById("cms-extension-last-refreshed");
        if (lastEl) {
            lastEl.textContent = `Last refreshed: ${new Date().toLocaleTimeString()}`;
        }
    } catch (e) {
        console.error("Error during button action:", e);
    } finally {
        button.disabled = false;
        button.textContent = "↻ Refresh Scores";
    }
}

async function refreshScores(force = true) {
    const elements = document.querySelectorAll(".nav-list li");
    await fetchAllScore(elements, force);
    updateSidebar();
    updateTotalScore();

    await storeStorageCache();
}

async function refreshSingleTask(url, task) {
    if (!url) return;
    // console.log(`Refreshing task at URL: ${url}`);
    if (responseCache.has(task)) {
        responseCache.delete(task);
        //   console.log(`Cache invalidated for: ${task}`);
    }
    const elements = document.querySelectorAll(".nav-list li");
    const taskElement = Array.from(elements).find((element, i) => {
        if (!element.classList.contains("nav-header")) return false;

        try {
            const taskName = (
                element.querySelector("span") || element
            ).textContent.trim();
            const taskUrl = elements[i + 2]?.querySelector("a")?.href;

            return taskName === task && taskUrl === url;
        } catch (e) {
            console.error("Error finding task:", e);
            return false;
        }
    });
    if (!taskElement) {
        console.error(`Element not found for task ${task}`);
        return;
    }
    try {
        const result = await fetchAndParseTask(url, task);
        if (result) {
            const { scoreValue, fullScoreValue } = result;
            score.set(task, scoreValue);
            fullScore.set(task, fullScoreValue);
            updateSidebarElement(taskElement);
            updateTotalScore();
            await storeStorageCache();
        }
    } catch (e) {
        console.error(`Error updating single task ${task}:`, e);
    }
}

function createControls() {
    const controlsContainer = document.createElement("div");
    controlsContainer.className = "cms-extension-controls";
    const totalScoreContainer = document.createElement("div");
    totalScoreContainer.className = "total-score-container";
    totalScoreContainer.id = "cms-extension-total-score";
    const refreshButton = document.createElement("button");
    refreshButton.className = "refresh-button";
    refreshButton.textContent = "↻ Refresh Scores";
    refreshButton.addEventListener("click", () =>
        withButtonDisabled(async () => {
            const url = window.location.href.split("?")[0];
            if (url.includes("/tasks/") && url.endsWith("/submissions")) {
                const task = url.split("/tasks/")[1]?.split("/")[0];
                await refreshSingleTask(url, task);
            } else {
                await refreshScores(true);
            }
        })
    );
    controlsContainer.appendChild(totalScoreContainer);
    controlsContainer.appendChild(refreshButton);
    // last refreshed timestamp
    const lastRefreshed = document.createElement("div");
    lastRefreshed.id = "cms-extension-last-refreshed";
    lastRefreshed.style.fontSize = "0.8em";
    lastRefreshed.style.color = "#666";
    controlsContainer.appendChild(lastRefreshed);
    document.body.appendChild(controlsContainer);
    updateTotalScore();
}

(async function () {
    if (!isCMSPage()) {
        // console.log("Not a CMS page, CMS extension has been disabled");
        return;
    }
    if (!user) return;
    // restore scroll position after reload
    const savedScroll = sessionStorage.getItem("cms-extension-scroll");
    if (savedScroll) {
        setTimeout(() => {
            window.scrollTo(0, parseInt(savedScroll, 10));
            sessionStorage.removeItem("cms-extension-scroll");
        }, 25);
    }
    // store scroll position when switching tasks
    document.querySelectorAll(".nav-list a").forEach((link) =>
        link.addEventListener("click", () => {
            sessionStorage.setItem("cms-extension-scroll", window.scrollY);
        })
    );
    await loadStorageCache();
    const elements = document.querySelectorAll(".nav-list li");
    updateSidebar();
    createControls();
    await fetchAllScore(elements);
    updateSidebar();
    updateTotalScore();
    await storeStorageCache();
})();

function getScore(parsedHtml) {
    const element = parsedHtml.querySelector(".task_score_container .score");
    return element ? element.textContent.trim() : "0/0";
}

function updateSidebarElement(element) {
    try {
        const task = (
            element.querySelector("span") || element
        ).textContent.trim();
        if (!score.has(task)) return;
        const currentScore = score.get(task);
        const currentFullScore = fullScore.get(task);
        // build elements safely
        // clear existing content
        element.textContent = "";
        const nameSpan = document.createElement("span");
        nameSpan.textContent = task;
        const scoreSpan = document.createElement("span");
        scoreSpan.style.float = "right";
        const badge = document.createElement("div");
        badge.classList.add("cms-score-badge", "task_score");
        const badgeClass =
            currentScore === currentFullScore
                ? "score_100"
                : currentScore > 0
                ? "score_0_100"
                : "score_0";
        badge.classList.add(badgeClass);
        badge.textContent = `${currentScore} / ${currentFullScore}`;
        scoreSpan.appendChild(badge);
        element.appendChild(nameSpan);
        element.appendChild(scoreSpan);
    } catch (e) {
        console.error(`Error updating task element ${element.innerHTML}:`, e);
    }
}

function updateSidebar() {
    const elements = document.querySelectorAll(".nav-list li");
    Array.from(elements).forEach((element, i) => {
        if (element.classList.contains("nav-header")) {
            updateSidebarElement(elements[i]);
        }
    });
}
