const baseURL = window.location.href.split(/(\/tasks)|(\/communication)|(\/documentation)|(\/testing)/)[0].replace(/\/+$/g, '');
const user = document.querySelector("em")?.textContent;

function isCMSPage() {
    const hasCMSNavigation = document.querySelector(".nav-list") !== null;
    const hasCMSHeader = document.querySelector(".navbar") !== null;
    const hasUserElement = document.querySelector("em") !== null;
    const hasTaskElements = document.querySelector(".task_score_container") !== null || document.querySelector("#task-statement") !== null;
    return (hasCMSNavigation && hasUserElement) || (hasCMSHeader && hasUserElement) || hasTaskElements;
}

var parser = new DOMParser();

var score = new Map();
var fullScore = new Map();
const responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const style = document.createElement('style');
style.textContent = `
  .cms-extension-controls {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .refresh-button {
    background-color: #4CAF50;
    color: white;
    border: none;
    padding: 10px;
    border-radius: 5px;
    cursor: pointer;
    font-weight: bold;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }
  .refresh-button:hover {
    background-color: #45a049;
  }
  .refresh-button:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
  }
  .total-score-container {
    background-color: #f0f0f0;
    padding: 10px;
    border-radius: 5px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    font-weight: bold;
  }
`;
document.head.appendChild(style);

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

function updateDisplay() {
    const { totalScore, totalFullScore } = calculateTotalScore();
    const totalScoreElement = document.getElementById('cms-extension-total-score');
    if (totalScoreElement) {
        const percentage = totalFullScore > 0 ? Math.round((totalScore / totalFullScore) * 100) : 0;
        totalScoreElement.textContent = `Total: ${totalScore} / ${totalFullScore} (${percentage}%)`;
    }
}

async function fetchAllScore(elements, force = false) {
    const promises = [];
    const data = [];
    for(let i = 2; i + 2 < elements.length; i += 3) {
        try {
            const names = elements[i].getElementsByTagName("span");
            const task = (names.length > 0 ? names[0] : elements[i]).textContent.trim();
            const url = elements[i + 2].getElementsByTagName("a")[0].href;
            if (force) {
                if (url && responseCache.has(url)) {
                    responseCache.delete(url);
                    console.log(`Cache invalidated for: ${url}`);
                }
            }
            data.push({ task, url, index: promises.length });
            promises.push(fetchAndParseTask(url, task));
        } catch (e) {
            console.error("Error fetching task:", e);
        }
    }
    const results = await Promise.allSettled(promises);
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            const { task, scoreValue, fullScoreValue } = result.value;
            score.set(task, scoreValue);
            fullScore.set(task, fullScoreValue);
        }
    });
    return results;
}

async function fetchAndParseTask(url, task) {
    try {
        const now = Date.now();
        const cachedResponse = responseCache.get(url);
        let htmlContent;
        if (cachedResponse && (now - cachedResponse.timestamp) < CACHE_TTL) {
            htmlContent = cachedResponse.data;
        } else {
            const response = await fetch(url, { cache: 'no-store' });
            htmlContent = await response.text();
            responseCache.set(url, { 
                data: htmlContent, 
                timestamp: now 
            });
        }
        const parsedHTML = parser.parseFromString(htmlContent, 'text/html');
        const scoreText = getScore(parsedHTML);
        const [scoreValue, fullScoreValue] = scoreText.split("/").map(val => parseInt(val, 10));
        
        return { task, scoreValue, fullScoreValue };
    } catch (e) {
        console.error(`Error fetching task ${task}:`, e);
        return null;
    }
}

async function refreshScores(force = true) {
    if(!user) return;
    
    const refreshButton = document.querySelector('.refresh-button');
    if (refreshButton) {
        refreshButton.disabled = true;
        refreshButton.textContent = 'Refreshing...';
    }
    
    const scoreKey = `${baseURL}_${user}_score`;
    const fullScoreKey = `${baseURL}_${user}_fullScore`;
    const elements = document.querySelectorAll(".nav-list li");
    await fetchAllScore(elements, force);
    updateSidebar();
    updateDisplay();
    const object = new Object();
    object[scoreKey] = Object.fromEntries(score);
    object[fullScoreKey] = Object.fromEntries(fullScore);
    await chrome.storage.sync.set(object);
    if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = '↻ Refresh Scores';
    }
}

async function refreshSingleTask(taskUrl) {
    if (!taskUrl || !user) return;
    console.log(`Refreshing task at URL: ${taskUrl}`);
    if (taskUrl && responseCache.has(taskUrl)) {
      responseCache.delete(taskUrl);
      console.log(`Cache invalidated for: ${taskUrl}`);
    }
    const elements = document.querySelectorAll(".nav-list li");
    let task = null;
    let taskElement = null;
    
    for(let i = 2; i + 2 < elements.length; i += 3) {
        try {
            const link = elements[i + 2].getElementsByTagName("a")[0];
            if (link && link.href === taskUrl) {
                const names = elements[i].getElementsByTagName("span");
                taskElement = elements[i];
                task = (names.length > 0 ? names[0] : elements[i]).textContent.trim();
                break;
            }
        } catch (e) {
            console.error("Error finding task:", e);
        }
    }
    if (!task) {
        console.log("Task not found for URL:", taskUrl);
        return;
    }
    try {
        const result = await fetchAndParseTask(taskUrl, task);
        if (result) {
            const { scoreValue, fullScoreValue } = result;
            score.set(task, scoreValue);
            fullScore.set(task, fullScoreValue);
            if (taskElement) {
                taskElement.innerHTML = `
                    <span>
                        ${task}
                    </span>
                    <span style="float:right">
                        <div
                            class="task_score score_${scoreValue == fullScoreValue ? '100' : scoreValue > 0 ? '0_100' : '0'}"
                            style="border-radius:4px; padding-left:4px; padding-right:4px; color:black"
                        >
                            ${scoreValue} / ${fullScoreValue}
                        </div>
                    </span>`;
                console.log(`Updated sidebar for ${task}`);
            } else {
                updateSidebar();
            }
            updateDisplay();
            const scoreKey = `${baseURL}_${user}_score`;
            const fullScoreKey = `${baseURL}_${user}_fullScore`;
            const object = new Object();
            object[scoreKey] = Object.fromEntries(score);
            object[fullScoreKey] = Object.fromEntries(fullScore);
            await chrome.storage.sync.set(object);
            console.log(`Updated score for ${task}: ${scoreValue}/${fullScoreValue}`);
        }
    } catch (e) {
        console.error(`Error updating single task ${task}:`, e);
    }
}

function createControls() {
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'cms-extension-controls';
    const totalScoreContainer = document.createElement('div');
    totalScoreContainer.className = 'total-score-container';
    totalScoreContainer.id = 'cms-extension-total-score';
    const refreshButton = document.createElement('button');
    refreshButton.className = 'refresh-button';
    refreshButton.textContent = '↻ Refresh Scores';
    refreshButton.addEventListener('click', async () => {
        refreshButton.disabled = true;
        refreshButton.textContent = 'Refreshing...';
        await refreshScores(true); 
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    });
    controlsContainer.appendChild(totalScoreContainer);
    controlsContainer.appendChild(refreshButton);
    document.body.appendChild(controlsContainer);
    updateDisplay();
}

function setupSubmissionListener() {
    if (window.location.href.includes('/tasks/')) {
        console.log('Setting up submission listener');
        document.addEventListener('submit', async (event) => {
            if (event.target.matches('form')) {
                console.log('Form submission detected');
                        setTimeout(async () => {
                          await refreshSingleTask(window.location.href);
                          window.location.reload();
                        }, 12000);
            }
        });
        const observer = new MutationObserver((mutations) => {
            let shouldRefresh = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    let element = mutation.target;
                    while (element) {
                        if (element.classList && 
                           (element.classList.contains('task_score_container') ||
                            element.classList.contains('score') ||
                            element.classList.contains('submission_result'))) {
                            shouldRefresh = true;
                            break;
                        }
                        element = element.parentElement;
                    }
                    if (mutation.addedNodes && mutation.addedNodes.length) {
                        for (let i = 0; i < mutation.addedNodes.length; i++) {
                            const node = mutation.addedNodes[i];
                            if (node.nodeType === Node.ELEMENT_NODE && 
                                (node.classList.contains('task_score_container') ||
                                 node.classList.contains('score') ||
                                 node.querySelector('.score') ||
                                 node.querySelector('.task_score_container'))) {
                                shouldRefresh = true;
                                break;
                            }
                        }
                    }
                }
                if (shouldRefresh) break;
            }
            if (shouldRefresh) {
                console.log('Score update detected by observer');
                setTimeout(async () => {
                  await refreshSingleTask(window.location.href);
                  window.location.reload();
                }, 500);
            }
        });
        setTimeout(() => {
            const scoreContainer = document.querySelector('.task_score_container');
            const taskContent = document.querySelector('#task-statement') || 
                               document.querySelector('.task-statement') ||
                               document.querySelector('.content');
            
            if (scoreContainer) {
                observer.observe(scoreContainer, { 
                    childList: true, 
                    subtree: true,
                    characterData: true
                });
                console.log('Observer attached to score container');
            }
            if (taskContent) {
                observer.observe(taskContent, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
                console.log('Observer attached to task content');
            }
            observer.observe(document.body, {
                childList: true,
                subtree: false
            });
            console.log('Observer attached to body');
        }, 1000);
    }
}

(async function() {
    if (!isCMSPage()) {
        console.log("Not a CMS page, CMS extension has been disabled");
        return;
    }
    if(!user) return;
    const storageCache = { count: 0 };
    try {
        await chrome.storage.sync.get().then((items) => {
            Object.assign(storageCache, items);
        });
    } catch {
        console.error('Error retrieving storage data');
    }
    storageCache.count++;
    chrome.storage.sync.set(storageCache);
    const scoreKey = `${baseURL}_${user}_score`;
    const fullScoreKey = `${baseURL}_${user}_fullScore`;
    data = await chrome.storage.sync.get([scoreKey, fullScoreKey]);
    if(data[scoreKey]) score = new Map(Object.entries(data[scoreKey]));
    if(data[fullScoreKey]) fullScore = new Map(Object.entries(data[fullScoreKey]));
    const elements = document.querySelectorAll(".nav-list li");
    updateSidebar();
    createControls();
    await fetchAllScore(elements);
    updateDisplay();
    updateSidebar();    
    setupSubmissionListener();
    const object = new Object();
    object[scoreKey] = Object.fromEntries(score);
    object[fullScoreKey] = Object.fromEntries(fullScore);
    chrome.storage.sync.set(object);
})();

function getScore(parsedHtml) {
    const element = parsedHtml.getElementsByClassName("task_score_container")[0].getElementsByClassName("score")[0];
    return element.textContent.trim();
}

function updateSidebar(){
    var elements = document.querySelectorAll(".nav-list li");
    for(let i = 2; i + 2 < elements.length; i += 3) {
        try {
            var element = elements[i];
            const task = element.textContent.trim();
            if(!score.has(task)) continue;
            currentScore = score.get(task);
            currentFullScore = fullScore.get(task);
            element.innerHTML = `
                <span>
                    ${task}
                </span>
                <span style="float:right">
                    <div
                        class="task_score score_${currentScore == currentFullScore ? '100' : currentScore > 0 ? '0_100' : '0'}"
                        style="border-radius:4px; padding-left:4px; padding-right:4px; color:black"
                    >
                        ${currentScore} / ${currentFullScore}
                    </div>
                </span>`;
        } catch {}
    }
}
