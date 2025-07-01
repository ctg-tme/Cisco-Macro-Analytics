document.addEventListener('DOMContentLoaded', () => {
  // State
  let selectedTool = 'analyze'; // Default tool
  let uploadedFile = null;      // Store uploaded file

  // DOM elements
  const toolButtons = document.getElementById('toolButtons');
  const fileInput = document.getElementById('fileInput');
  const fileName = document.getElementById('fileName');
  const resultsDiv = document.getElementById('results');
  const resultsContainer = document.getElementById('results-container');

  const fileDropZone = document.getElementById('fileDropZone');
  const fileDropMessage = document.getElementById('fileDropMessage');

  // Show file dialog on click
  fileDropZone.addEventListener('click', () => fileInput.click());

  // Highlight drop zone on dragover/dragenter
  ['dragenter', 'dragover'].forEach(eventName => {
    fileDropZone.addEventListener(eventName, e => {
      e.preventDefault();
      fileDropZone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(eventName => {
    fileDropZone.addEventListener(eventName, e => {
      e.preventDefault();
      fileDropZone.classList.remove('is-dragover');
    });
  });

  // Handle file drop
  fileDropZone.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length) {
      fileInput.files = droppedFiles; // Simulate file input
      fileInput.dispatchEvent(new Event('change')); // Trigger upload logic
    }
  });

  // Optional: Style when dragging
  const style = document.createElement('style');
  style.textContent = `
  #fileDropZone.is-dragover,
  #fileDropZone:hover {
    background:rgb(0, 209, 178, 0.5);
    border-color:rgb(0, 255, 217);
    color: white;
  }
`;
  document.head.appendChild(style);

  // Helper to escape HTML (for safe code block rendering)
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Tool button switching logic
  toolButtons.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tool]');
    if (!btn) return;
    const newTool = btn.getAttribute('data-tool');
    if (newTool === selectedTool) return;

    if (uploadedFile) {
      const proceed = confirm(
        `You have already uploaded a file. Switching to "${btn.textContent.trim()}" will clear your current upload. Continue?`
      );
      if (!proceed) return;
      // Clear file state and UI
      fileInput.value = "";
      fileName.textContent = "Macro Name Not Found";
      resultsDiv.innerHTML = "";
      const oldBtn = document.getElementById('copyBtn');
      if (oldBtn) oldBtn.remove();
      uploadedFile = null;
    }
    selectedTool = newTool;

    // Visually highlight the selected button
    toolButtons.querySelectorAll('button').forEach(b => b.classList.remove('is-primary'));
    btn.classList.add('is-primary');
  });

  // File upload logic
  fileInput.addEventListener('change', () => {
    // Remove existing copy button if present
    const oldBtn = document.getElementById('copyBtn');
    if (oldBtn) oldBtn.remove();

    uploadedFile = fileInput.files[0] || null;
    fileName.textContent = uploadedFile ? uploadedFile.name : "Macro Name Not Found";
    resultsDiv.innerHTML = "";

    if (!uploadedFile) {
      alert("Failed to load file");
      return;
    }
    // Restrict to .js files only
    if (!uploadedFile.name.endsWith('.js')) {
      alert("Please select a JavaScript (.js) file that contains Macro Code");
      fileInput.value = "";
      uploadedFile = null;
      fileName.textContent = "Macro Name Not Found";
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      const content = event.target.result;

      switch (selectedTool) {
        case 'analyze':
          processAnalyze(content);
          break;
        case 'repair':
          processRepair(content);
          break;
        // Add more cases as you add tools
        default:
          resultsDiv.textContent = "Unknown tool selected.";
      }
    };
    reader.readAsText(uploadedFile);
  });

  // Analyze Macro
  async function processAnalyze(content) {
    const analyzeContent = await analyzeMacro(content); // You must define this elsewhere
    const stringifiedAnalyzedContent = JSON.stringify(analyzeContent, null, 2);
    // resultsDiv.innerHTML = '<pre><code class="language-json">' + escapeHtml(stringifiedAnalyzedContent) + '</code></pre>';
    loadResults(stringifiedAnalyzedContent, 'results')
    addCopyButton(stringifiedAnalyzedContent);
  }

  // Repair Macro (stub function, replace as needed)
  function processRepair(content) {
    const repaired = repairMacro(content); // You must define this elsewhere
    const stringified = JSON.stringify(repaired, null, 2);
    resultsDiv.innerHTML = '<pre><code class="language-json">' + escapeHtml(stringified) + '</code></pre>';
    addCopyButton(stringified);
  }

  // Adds the copy button to the results container
  function addCopyButton(content) {
    const copyBtn = document.createElement('button');
    copyBtn.id = 'copyBtn';
    copyBtn.className = 'button is-light';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.style.position = 'absolute';
    copyBtn.style.top = '1rem';
    copyBtn.style.right = '3rem';
    copyBtn.style.zIndex = 10;
    copyBtn.innerHTML = '<span class="icon"><i class="fa-regular fa-copy"></i></span>';

    copyBtn.onclick = function () {
      navigator.clipboard.writeText(content)
        .then(() => {
          copyBtn.innerHTML = '<span class="icon has-text-success"><i class="fa-solid fa-check"></i></span>';
          setTimeout(() => {
            copyBtn.innerHTML = '<span class="icon"><i class="fa-regular fa-copy"></i></span>';
          }, 1200);
        })
        .catch(() => alert("Copy failed!"));
    };
    copyBtn.addEventListener('mouseenter', () => copyBtn.classList.remove('is-light'));
    copyBtn.addEventListener('mouseleave', () => copyBtn.classList.add('is-light'));
    resultsContainer.appendChild(copyBtn);
  }

  // Example stub for repairMacro function
  function repairMacro(content) {
    // Replace with your actual repair logic
    return { repaired: true, original: content };
  }
});