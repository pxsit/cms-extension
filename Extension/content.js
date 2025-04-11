const baseURL = window.location.href.split(/(\/tasks)|(\/communication)|(\/documentation)|(\/testing)/)[0].replace(/\/+$/g, '');
const user = document.querySelector("em")?.textContent;

var parser = new DOMParser();

var score = new Map();
var fullScore = new Map();

(async function() {
    if(!user) return;
    
    const storageCache = { count: 0 };
    try {
        await chrome.storage.sync.get().then((items) => {
            Object.assign(storageCache, items);
        });
    } catch {}

    storageCache.count++;
    chrome.storage.sync.set(storageCache);

    const scoreKey = `${baseURL}_${user}_score`;
    const fullScoreKey = `${baseURL}_${user}_fullScore`;
    data = await chrome.storage.sync.get([scoreKey, fullScoreKey]);
    if(data[scoreKey]) score = new Map(Object.entries(data[scoreKey]));
    if(data[fullScoreKey]) fullScore = new Map(Object.entries(data[fullScoreKey]));

    const elements = document.querySelectorAll(".nav-list li");

    updateSidebar();

    for(let i = 2; i + 2 < elements.length; i += 3) {
        try {
            const names = elements[i].getElementsByTagName("span");
            const taskName = (names.length > 0 ? names[0] : elements[i]).textContent.trim();
            const url = elements[i + 2].getElementsByTagName("a")[0].href;
            
            const response = await fetch(url);
            const htmlContent = await response.text();
            const parsedHTML = parser.parseFromString(htmlContent, 'text/html');
            
            const result = getScore(parsedHTML).split("/");
            score.set(taskName, parseInt(result[0]));
            fullScore.set(taskName, parseInt(result[1]));
        } catch {}
    }

    updateSidebar();

    object = new Object();
    object[scoreKey] = Object.fromEntries(score);
    object[fullScoreKey] = Object.fromEntries(fullScore);
    chrome.storage.sync.set(object);
})()

function getScore(parsedHtml) {
    const element = parsedHtml.getElementsByClassName("task_score_container")[0].getElementsByClassName("score")[0];
    return element.textContent.trim();
}

function updateSidebar(){
    var elements = document.querySelectorAll(".nav-list li");
    for(let i = 2; i + 2 < elements.length; i += 3) {
        try {
            var element = elements[i];
            const taskName = element.textContent.trim();
            if(!score.has(taskName)) continue;
            currentScore = score.get(taskName);
            currentFullScore = fullScore.get(taskName);
            element.innerHTML = `
                <span>
                    ${taskName}
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