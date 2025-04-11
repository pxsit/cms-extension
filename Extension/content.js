var parser = new DOMParser();

(async function() {
    var elements = document.querySelectorAll(".nav-list li");
    for(let i = 2; i + 2 < elements.length; i += 3) {
        try {
        const taskName = elements[i].textContent.trim();
        const url = elements[i + 2].getElementsByTagName("a")[0].href;
        const response = await fetch(url);
        const htmlContent = await response.text();
        const parsedHTML = parser.parseFromString(htmlContent, 'text/html');
        const result = getScore(parsedHTML).split(" / ");
        const score = parseInt(result[0]);
        const fullScore = parseInt(result[1]);
        var element = elements[i];
        element.innerHTML = `
            ${taskName}
            <span style="float:right">
                <div class="task_score score_${score == fullScore ? '100' : score>0 ? '0_100' : '0'}" style="border-radius:4px; padding-left:4px; padding-right:4px; color:black">
                    ${score} / ${fullScore}
                </div>
            </span>`;
        } catch {}
    }
})()

function getScore(parsedHtml) {
    var element = parsedHtml.getElementsByClassName("task_score_container")[0].getElementsByClassName("score")[0];
    return element.textContent.trim();
}