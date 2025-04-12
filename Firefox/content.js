const baseURL = window.location.href.split(/(\/tasks)|(\/communication)|(\/documentation)|(\/testing)/)[0].replace(/\/+$/g, '');
const user = document.querySelector("em")?.textContent;

const parser = new DOMParser();

let score = new Map();
let fullScore = new Map();

(async function () {
    if (!user) return;

    updateUIDark();

    const storageCache = { count: 0 };
    try {
        const items = await browser.storage.sync.get();
        Object.assign(storageCache, items);
    } catch (error) {
        console.error('Error getting storage:', error);
    }

    storageCache.count++;
    browser.storage.sync.set(storageCache);

    const scoreKey = `${baseURL}_${user}_score`;
    const fullScoreKey = `${baseURL}_${user}_fullScore`;

    try {
        const data = await browser.storage.sync.get([scoreKey, fullScoreKey]);
        if (data[scoreKey]) score = new Map(Object.entries(data[scoreKey]));
        if (data[fullScoreKey]) fullScore = new Map(Object.entries(data[fullScoreKey]));
    } catch (error) {
        console.error('Error loading scores:', error);
    }

    const elements = document.querySelectorAll(".nav-list li");

    updateSidebar();

    for (let i = 2; i + 2 < elements.length; i += 3) {
        try {
            const names = elements[i].getElementsByTagName("span");
            const taskName = (names.length > 0 ? names[0] : elements[i]).textContent.trim();
            const url = elements[i + 2].querySelector("a")?.href;

            if (!url) continue;

            const response = await fetch(url);
            const htmlContent = await response.text();
            const parsedHTML = parser.parseFromString(htmlContent, 'text/html');

            const result = getScore(parsedHTML).split("/");
            score.set(taskName, parseInt(result[0]));
            fullScore.set(taskName, parseInt(result[1]));
        } catch (error) {
            console.error('Error fetching or parsing task:', error);
        }
    }

    updateSidebar();

    const object = {};
    object[scoreKey] = Object.fromEntries(score);
    object[fullScoreKey] = Object.fromEntries(fullScore);

    browser.storage.sync.set(object);
})();

function updateUIDark() {
    document.body.style.background = "oklch(26.9% 0 0)";
    document.body.style.color = "white";
    document.querySelectorAll('table.table-striped').forEach(table => {
        table.classList.remove('table-striped');
    });
    document.querySelectorAll('#countdown, #server_time').forEach(span => {
        span.style.color = "white";
    });
    document.querySelectorAll('.well').forEach(well => {
        well.style.background = "oklch(43.9% 0 0)";
        well.style.color = "white";
    });
    document.querySelectorAll('.nav li').forEach(li => {
        li.style.color = "oklch(80.9% 0.105 251.813)";
    });
    document.querySelectorAll('.nav-header').forEach(header => {
        header.style.color = "white";
    });
    document.querySelectorAll('code').forEach(code => {
        code.style.background = "oklch(43.9% 0 0)";
        code.style.color = "pink";
    });
    updateSubmissionDetailDark();
}

function updateSubmissionDetailDark() {
    const modal = document.getElementById('submission_detail');
    if (modal) {
        modal.style.background = "oklch(26.9% 0 0)";
        modal.querySelectorAll('.score_details table.table-striped').forEach(table => {
            table.classList.remove('table-striped');
        });
        modal.querySelectorAll('pre').forEach(pre => {
            pre.style.background = "oklch(43.9% 0 0)";
            pre.style.color = "pink";
        });
        modal.querySelectorAll('.modal-footer').forEach(footer => {
            footer.style.background = "oklch(26.9% 0 0)";
        });
    }
}

const observer = new MutationObserver(() => {
    const modal = document.getElementById('submission_detail');
    if (modal && getComputedStyle(modal).display === 'block') {
        updateSubmissionDetailDark();
    }
});

observer.observe(document.body, { attributes: true, childList: true, subtree: true });

function getScore(parsedHtml) {
    const element = parsedHtml.querySelector(".task_score_container .score");
    return element ? element.textContent.trim() : "0/0";
}

function updateSidebar() {
    const elements = document.querySelectorAll(".nav-list li");
    for (let i = 2; i + 2 < elements.length; i += 3) {
        try {
            const element = elements[i];
            const taskName = element.textContent.trim();
            if (!score.has(taskName)) continue;
            const currentScore = score.get(taskName);
            const currentFullScore = fullScore.get(taskName);
            element.innerHTML = `
                <span>
                    ${taskName}
                </span>
                <span style="float:right">
                    <div
                        class="task_score score_${currentScore == currentFullScore ? '100' : currentScore > 0 ? '0_100' : '0'}"
                        style="border-radius:4px; padding-left:4px; padding-right:4px; color:white"
                    >
                        ${currentScore} / ${currentFullScore}
                    </div>
                </span>`;
        } catch (error) {
            console.error('Error updating sidebar:', error);
        }
    }
}
