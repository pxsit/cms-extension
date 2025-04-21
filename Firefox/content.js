// Config

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ===

const baseURL = window.location.href
  .split(/(\/tasks)|(\/communication)|(\/documentation)|(\/testing)/)[0]
  .replace(/\/+$/g, "");
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

async function loadStorageCache() {
  const storageCache = { count: 0 };
  try {
    const items = await browser.storage.local.get();
    Object.assign(storageCache, items);
  } catch (e) {
    console.error("Error retrieving storage data");
  }

  storageCache.count++;
  browser.storage.local.set(storageCache);

  const responseCacheKey = `${baseURL}_${user}_responseCache`;

  const data = await browser.storage.local.get([responseCacheKey]);

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
    await browser.storage.local.set(object);
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
  const totalScoreElement = document.getElementById(
    "cms-extension-total-score"
  );
  if (totalScoreElement) {
    const percentage =
      totalFullScore > 0 ? Math.round((totalScore / totalFullScore) * 100) : 0;
    totalScoreElement.textContent = `Total: ${totalScore} / ${totalFullScore} (${percentage}%)`;
  }
}

async function fetchAllScore(elements, force = false) {
  const promises = [];
  Array.from(elements).forEach((element, i) => {
    if (element.classList.contains("nav-header")) {
      try {
        const task = (
          element.querySelector("span") || element
        ).textContent.trim();
        const url = elements[i + 2]?.querySelector("a")?.href;
        if (url) {
          if (force) {
            if (responseCache.has(task)) {
              responseCache.delete(task);
              // console.log(`Cache invalidated for: ${task}`);
            }
          }
          promises.push(fetchAndParseTask(url, task));
        }
      } catch (e) {
        console.error("Error fetching task:", e);
      }
    }
  });
  const results = await Promise.allSettled(promises);
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) {
      const { task, scoreValue, fullScoreValue } = result.value;
      score.set(task, scoreValue);
      fullScore.set(task, fullScoreValue);
    }
  });
  return results;
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
  } catch (e) {
    console.error("Error during button action:", e);
  }

  button.disabled = false;
  button.textContent = "↻ Refresh Scores";
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
  document.body.appendChild(controlsContainer);
  updateTotalScore();
}

function setupSubmissionListener() {
  if (window.location.href.includes("/tasks/")) {
    // console.log('Setting up submission listener');
    document.addEventListener("submit", async (event) => {
      if (event.target.matches("form")) {
        // console.log('Form submission detected');
        setTimeout(
          () =>
            withButtonDisabled(async () => {
              const url = window.location.href.split("?")[0];
              const task = url.split("/tasks/")[1]?.split("/")[0];
              await refreshSingleTask(url, task);
            }),
          12000
        );
      }
    });
    const observer = new MutationObserver((mutations) => {
      let shouldRefresh = true;
      for (const mutation of mutations) {
        if (
          mutation.type === "childList" ||
          mutation.type === "characterData"
        ) {
          let element =
            mutation.target instanceof Node
              ? mutation.target.parentElement
              : null;
          while (element) {
            if (
              element.classList &&
              (element.classList.contains("task_score_container") ||
                element.classList.contains("score"))
            ) {
              shouldRefresh = true;
              break;
            }
            element = element.parentElement;
          }
          if (!shouldRefresh && mutation.addedNodes?.length) {
            for (const node of mutation.addedNodes) {
              if (
                node.nodeType === Node.ELEMENT_NODE &&
                (node.classList.contains("task_score_container") ||
                  node.classList.contains("score") ||
                  node.querySelector(".score") ||
                  node.querySelector(".task_score_container"))
              ) {
                shouldRefresh = true;
                break;
              }
            }
          }
        }
        if (shouldRefresh) break;
      }
      if (shouldRefresh) {
        // console.log('Score update detected by observer');
        setTimeout(() =>
          withButtonDisabled(async () => {
            const url = window.location.href.split("?")[0];
            const task = url.split("/tasks/")[1]?.split("/")[0];
            await refreshSingleTask(url, task);
          }, 500)
        );
      }
    });
    setTimeout(() => {
      const scoreContainer = document.querySelector(".task_score_container");

      if (scoreContainer) {
        observer.observe(scoreContainer, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        // console.log('Observer attached to score container');
      }
    }, 1000);
  }
}

// --- TOI Pre‑TOI overview box) ---
function parseScore(scoreText) {
  const match = scoreText.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

function analyzeTasks() {
  const rows = document.querySelectorAll("table tbody tr");
  let a1 = 0, a2 = 0, a3 = 0;
  rows.forEach(row => {
    const [scoreCell, taskCell] = row.children;
    if (!scoreCell || !taskCell) return;
    const score = parseScore(scoreCell.textContent);
    const group = taskCell.textContent.trim().split("-")[0];
    if (score >= 80) {
      if (group === "A1") a1++;
      else if (group === "A2") a2++;
      else if (group === "A3") a3++;
    }
  });
  return { a1, a2, a3 };
}

function createScoreBox(a1, a2, a3) {
  const container = document.createElement("div");
  container.style.padding = "12px";
  container.style.marginBottom = "20px";
  container.style.fontSize = "16px";
  container.style.fontWeight = "bold";
  container.style.backgroundColor = "#fff";
  container.style.color = "#000";
  container.style.width = "100%";
  const totalA2A3 = a2 + a3;
  const totalAll = a1 + totalA2A3;
  container.innerHTML = `
  A1: ${a1} ข้อ<br> 
  A2: ${a2} ข้อ<br> 
  A3: ${a3} ข้อ<br> 
  ${totalAll >= 40 ? '✅' : '❌'} รวมทกข้อ : ${totalAll} ข้อ <br>
  ${totalA2A3 >= 20 ? '✅' : '❌'} รวม A2+A3 : ${totalA2A3} ข้อ <br>
  ${(totalAll >= 40 && totalA2A3 >= 20)? '✅<span style="color: green;"> ผ่านเกณฑ์</span>' : '❌<span style="color: red;"> ไม่ผ่านเกณฑ์</span>'}<br>
  `;
  return container;
}

function insertScoreBoxTOI() {
  const { a1, a2, a3 } = analyzeTasks();
  const overviewHeader = Array.from(
    document.querySelectorAll("h2")
  ).find(h => h.textContent.includes("Task overview"));
  if (overviewHeader) {
    const box = createScoreBox(a1, a2, a3);
    overviewHeader.parentElement.insertBefore(box, overviewHeader.nextSibling);
  }
}
if (
  window.location.href.startsWith(
    "https://toi-coding.informatics.buu.ac.th/00-pre-toi"
  )
) {
  window.addEventListener("load", () => setTimeout(insertScoreBoxTOI, 500));
}

(async function () {
  if (!isCMSPage()) {
    // console.log("Not a CMS page, CMS extension has been disabled");
    return;
  }
  if (!user) return;

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

function updateSidebarElement(element) {
  try {
    const task = (element.querySelector("span") || element).textContent.trim();
    if (!score.has(task)) return;

    const currentScore = score.get(task);
    const currentFullScore = fullScore.get(task);
    element.textContent = "";
    const taskSpan = document.createElement("span");
    taskSpan.textContent = task;
    const scoreContainer = document.createElement("span");
    scoreContainer.style.float = "right";

    const scoreBadge = document.createElement("div");
    scoreBadge.className = `cms-score-badge task_score score_${
      currentScore == currentFullScore
        ? "100"
        : currentScore > 0
        ? "0_100"
        : "0"
    }`;
    scoreBadge.textContent = `${currentScore} / ${currentFullScore}`;

    scoreContainer.appendChild(scoreBadge);
    element.appendChild(taskSpan);
    element.appendChild(scoreContainer);
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
