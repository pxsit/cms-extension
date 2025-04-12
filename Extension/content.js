// Config

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ===

const baseURL = window.location.href.split(/(\/tasks)|(\/communication)|(\/documentation)|(\/testing)/)[0].replace(/\/+$/g, '');
const user = document.querySelector("em")?.textContent;

function isCMSPage() {
    const hasCMSHeader = !!document.querySelector(".navbar");
    const hasUserElement = !!document.querySelector("em");
    return hasCMSHeader && hasUserElement;
}

const parser = new DOMParser();

let score = new Map();
let fullScore = new Map();
let responseCache = new Map();

async function loadStorageCache(){
    const storageCache = { count: 0 };
    try {
		const items = await chrome.storage.local.get();
		Object.assign(storageCache, items);
    } catch (e) {
        console.error('Error retrieving storage data');
    }
    
    storageCache.count++;
    chrome.storage.local.set(storageCache);

    const responseCacheKey = `${baseURL}_${user}_responseCache`;

    const data = await chrome.storage.local.get([responseCacheKey]);

    if(data[responseCacheKey]) {
		responseCache = new Map(Object.entries(data[responseCacheKey]));
		responseCache.forEach((value, key) => {
			score.set(key, value.score);
			fullScore.set(key, value.fullScore);
		})
	}
}

async function storeStorageCache(){
    const responseCacheKey = `${baseURL}_${user}_responseCache`;

    const object = new Object();
    object[responseCacheKey] = Object.fromEntries(responseCache);

	try {
    	await chrome.storage.local.set(object);
	} catch (e) {
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
    const totalScoreElement = document.getElementById('cms-extension-total-score');
    if (totalScoreElement) {
        const percentage = totalFullScore > 0 ? Math.round((totalScore / totalFullScore) * 100) : 0;
        totalScoreElement.textContent = `Total: ${totalScore} / ${totalFullScore} (${percentage}%)`;
    }
}

async function fetchAllScore(elements, force = false) {
    const promises = [];
    for(let i = 2; i + 2 < elements.length; i += 3) {
        try {
            const names = elements[i].getElementsByTagName("span");
            const task = (names.length > 0 ? names[0] : elements[i]).textContent.trim();
            const url = elements[i + 2].getElementsByTagName("a")[0].href;
			if (force) {
				if (responseCache.has(task)) {
					responseCache.delete(task);
					console.log(`Cache invalidated for: ${task}`);
				}
			}
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
	if(!url) return null;
    try {
        const now = Date.now();
        const cachedResponse = responseCache.get(task);
        let scoreValue, fullScoreValue;
        if (cachedResponse && (now - cachedResponse.timestamp) < CACHE_TTL) {
            scoreValue = cachedResponse.score;
            fullScoreValue = cachedResponse.fullScore;
        } else {
            const response = await fetch(url, { cache: 'no-store' });
            const htmlContent = await response.text();
            const parsedHTML = parser.parseFromString(htmlContent, 'text/html');
            const result = getScore(parsedHTML).split("/").map(val => parseInt(val, 10));
			scoreValue = result[0];
			fullScoreValue = result[1];
            responseCache.set(task, { 
                score: scoreValue,
				fullScore: fullScoreValue,
                timestamp: now 
            });
        }
        return { task, scoreValue, fullScoreValue };
    } catch (e) {
        console.error(`Error fetching task ${task}:`, e);
        return null;
    }
}

async function withButtonDisabled(asyncFn) {
    const button = document.querySelector('.refresh-button');
    if (!button) return;

	button.disabled = true;
	button.textContent = 'Refreshing...';

    try {
        await asyncFn();
    } catch (e) {
        console.error('Error during button action:', e);
    }

	button.disabled = false;
	button.textContent = '↻ Refresh Scores';
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
    console.log(`Refreshing task at URL: ${url}`);
    if (responseCache.has(task)) {
      responseCache.delete(task);
      console.log(`Cache invalidated for: ${task}`);
    }
    const elements = document.querySelectorAll(".nav-list li");
    let taskElement = null;
    
    for(let i = 2; i + 2 < elements.length; i += 3) {
        try {
			const names = elements[i].getElementsByTagName("span");
			const taskName = (names.length > 0 ? names[0] : elements[i]).textContent.trim();
            const taskUrl = elements[i + 2].getElementsByTagName("a")[0]?.href;
            if (task == taskName && url === taskUrl) {
                taskElement = elements[i];
                break;
            }
        } catch (e) {
            console.error("Error finding task:", e);
        }
    }
    if (!taskElement) {
        console.log("Element not found for task:", task);
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
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'cms-extension-controls';
    const totalScoreContainer = document.createElement('div');
    totalScoreContainer.className = 'total-score-container';
    totalScoreContainer.id = 'cms-extension-total-score';
    const refreshButton = document.createElement('button');
    refreshButton.className = 'refresh-button';
    refreshButton.textContent = '↻ Refresh Scores';
    refreshButton.addEventListener('click', () => 
		withButtonDisabled(async () => {
			const url = window.location.href;
			if (url.includes("/tasks/") && url.endsWith("/submissions")) {
				const task = url.split("/tasks/")[1]?.split("/")[0];
				await refreshSingleTask(url, task);
			} else {
				await refreshScores(true); 
			}
    }));
    controlsContainer.appendChild(totalScoreContainer);
    controlsContainer.appendChild(refreshButton);
    document.body.appendChild(controlsContainer);
    updateTotalScore();
}

function setupSubmissionListener() {
    if (window.location.href.includes('/tasks/')) {
        console.log('Setting up submission listener');
        document.addEventListener('submit', async (event) => {
            if (event.target.matches('form')) {
                console.log('Form submission detected');
				setTimeout(() => withButtonDisabled(async () => {
					const task = window.location.href.split("/tasks/")[1]?.split("/")[0];
					await refreshSingleTask(window.location.href, task);
				}), 12000);
            }
        });
        const observer = new MutationObserver((mutations) => {
			let shouldRefresh = true;
            for (const mutation of mutations) {
				console.log('mutation found');
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    let element = mutation.target instanceof Node ? mutation.target.parentElement : null;
                    while (element) {
                        if (element.classList && 
                           (element.classList.contains('task_score_container') ||
                            element.classList.contains('score'))) {
                            shouldRefresh = true;
                            break;
                        }
                        element = element.parentElement;
                    }
                    if (!shouldRefresh && mutation.addedNodes?.length) {
						for (const node of mutation.addedNodes) {
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
                setTimeout(() => withButtonDisabled(async () => {
                  	await refreshSingleTask(window.location.href);
                }, 500));
            }
        });
        setTimeout(() => {
            const scoreContainer = document.querySelector('.task_score_container');

            if (scoreContainer) {
                observer.observe(scoreContainer, { 
                    childList: true, 
                    subtree: true,
                    characterData: true
                });
                console.log('Observer attached to score container');
            }
        }, 1000);
    }
}

(async function() {
    if (!isCMSPage()) {
        console.log("Not a CMS page, CMS extension has been disabled");
        return;
    }
    if(!user) return;

    await loadStorageCache();

    const elements = document.querySelectorAll(".nav-list li");
    updateSidebar();
    createControls();

    await fetchAllScore(elements);

    updateSidebar();
    updateTotalScore();
    
    await storeStorageCache();

    setupSubmissionListener();
})();

function getScore(parsedHtml) {
    const element = parsedHtml.querySelector(".task_score_container .score");
    return element ? element.textContent.trim() : "0/0";
}

function updateSidebarElement(element){
	try {
		const names = element.getElementsByTagName("span");
		const task = (names.length > 0 ? names[0] : element).textContent.trim();
		if(!score.has(task)) return;
		const currentScore = score.get(task);
		const currentFullScore = fullScore.get(task);
		element.innerHTML = `
			<span>
				${task}
			</span>
			<span style="float:right">
				<div
					class="
						cms-score-badge
						task_score
						score_${currentScore == currentFullScore ? '100' : currentScore > 0 ? '0_100' : '0'}
				">
					${currentScore} / ${currentFullScore}
				</div>
			</span>`;
	} catch (e) {
        console.error(`Error updating task element ${element.innerHTML}:`, e);
	}
}

function updateSidebar(){
    const elements = document.querySelectorAll(".nav-list li");
    for(let i = 2; i + 2 < elements.length; i += 3) {
        updateSidebarElement(elements[i]);
    }
}
