document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const fileName = document.getElementById('fileName');
  const resultsDiv = document.getElementById('results');
  const resultsContainer = document.getElementById('results-container');

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  fileInput.addEventListener('change', () => {
    // Remove existing copy button if present
    const oldBtn = document.getElementById('copyBtn');
    if (oldBtn) oldBtn.remove();

    const file = fileInput.files[0];
    fileName.textContent = file ? file.name : "Macro Name Not Found";
    if (!file) {
      alert("Failed to load file")
      return;
    }
    // Check file extension
    if (!file.name.endsWith('.js')) {
      alert("Please select a JavaScript (.js) file that contains Macro Code")
      return;
    }
    const reader = new FileReader();
    reader.onload = function (event) {
      const content = event.target.result;
      const analyzeContent = analyzeMacro(content);
      const stringifiedAnalyzedContent = JSON.stringify(analyzeContent, null, 2)
      resultsDiv.innerHTML = '<pre><code class="language-json">' + stringifiedAnalyzedContent + '</code></pre>';

      // Create the copy button
      const copyBtn = document.createElement('button');
      copyBtn.id = 'copyBtn';
      copyBtn.className = 'button is-light';
      copyBtn.title = 'Copy to clipboard';
      copyBtn.style.position = 'absolute';
      copyBtn.style.top = '0.5rem';
      copyBtn.style.right = '0.5rem';
      copyBtn.style.zIndex = 10;
      copyBtn.innerHTML = '<span class="icon"><i class="fa-regular fa-copy"></i></span>';

      // Copy logic
      copyBtn.onclick = function () {
        navigator.clipboard.writeText(stringifiedAnalyzedContent)
          .then(() => {
            copyBtn.innerHTML = '<span class="icon has-text-success"><i class="fa-solid fa-check"></i></span>';
            setTimeout(() => {
              copyBtn.innerHTML = '<span class="icon"><i class="fa-regular fa-copy"></i></span>';
            }, 1200);
          })
          .catch(() => alert("Copy failed!"));
      };

      copyBtn.addEventListener('mouseenter', () => {
        copyBtn.classList.remove('is-light');
      });
      copyBtn.addEventListener('mouseleave', () => {
        copyBtn.classList.add('is-light');
      });

      // Add the button to the container
      resultsContainer.appendChild(copyBtn);
    };
    reader.readAsText(file);
  });
});