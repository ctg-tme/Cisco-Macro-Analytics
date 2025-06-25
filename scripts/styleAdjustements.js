function updateCurrentYear() {
  const today = new Date();
  const currentYear = document.getElementById('currentYear');
  currentYear.innerHTML = today.getFullYear();
}

function updateVersionNumber() {
  fetch('./manifest.json')
    .then(response => response.json())
    .then(manifest => {
      Object.entries(manifest).forEach(([key, value]) => {
        if (key.toLowerCase() == 'version') {
          document.querySelectorAll('.' + 'appVersion').forEach(el => {
            el.textContent = value;
          });
        }
      });
    });
}

function updateAppDependenciesTable() {
  fetch('./manifest.json')
    .then(response => response.json())
    .then(manifest => {
      const dependencies = manifest.Dependencies

      let output = `
    <table class="table is-fullwidth is-striped is-hoverable is-size-7">
      <thead>
        <tr>
          <th>Name</th>
          <th>Version</th>
          <th>Host</th>
        </tr>
      </thead>
      <tbody>
  `;
      Object.entries(dependencies).forEach(([name, info]) => {
        const version = info.Version ? `${info.Version}` : 'N/A';
        output += `
      <tr>
        <td>${name}</td>
        <td>${version}</td>
        <td>${info.Host}</td>
      </tr>
    `;
      });
      output += `
      </tbody>
    </table>
  `;

      document.querySelectorAll('.appDependency').forEach(el => {
        el.innerHTML = output;
      });
    });
}

function updateAppNews() {
  fetch('./manifest.json')
    .then(response => response.json())
    .then(manifest => {
      const news = manifest.News.Messages; // or adjust path as needed

      console.log(news)

      let output = '<ul class="app-news">';
      news.forEach(msg => {
        output += `<li style="margin-bottom:1.5em;">${msg.Text}`;
        if (msg.ImagePath) {
          output += `<br><img src="${msg.ImagePath}" class="enlargeable-image" alt="" style="max-width: 100%; margin-top: 0.5em;">`;
        }
        output += '</li>';
      });
      output += '</ul>';

      document.querySelectorAll('.appNews').forEach(el => {
        el.innerHTML = output;
      });
    });
}

function adjustBodyMarginForMenu() {
  const menu = document.getElementById('navbarMain');
  if (window.innerWidth <= 1023) {
    if (menu && menu.classList.contains('is-active')) {
      const menuHeight = menu.offsetHeight;
      // console.log("Setting margin-top:", menuHeight, "px");
      document.body.style.marginTop = menuHeight + 'px';
    } else {
      // console.log("Resetting margin-top");
      document.body.style.marginTop = null;
    }
  } else {
    // console.log("Desktop: Resetting margin-top");
    document.body.style.marginTop = null;
  }
}

window.onload = () => {
  updateCurrentYear();
  updateVersionNumber();
  updateAppDependenciesTable();
  updateAppNews();
}

document.addEventListener('DOMContentLoaded', () => {
  const $navbarBurgers = Array.prototype.slice.call(document.querySelectorAll('.navbar-burger'), 0);

  if ($navbarBurgers.length > 0) {
    $navbarBurgers.forEach(el => {
      el.addEventListener('click', () => {
        const target = el.dataset.target;
        const $target = document.getElementById(target);

        el.classList.toggle('is-active');
        $target.classList.toggle('is-active');
        adjustBodyMarginForMenu()
      });
    });
  }

  const burger = document.querySelector('.navbar-burger');
  const menu = document.getElementById('navbarMain');

  burger.addEventListener('click', () => {
    const isActive = menu.classList.contains('is-active');
    if (!isActive) {
      document.body.classList.remove('menu-active');
    } else {
      document.body.classList.add('menu-active');
    }
  });
})

window.addEventListener('resize', adjustBodyMarginForMenu);

document.addEventListener('DOMContentLoaded', adjustBodyMarginForMenu);

document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', function(event) {
    const img = event.target.closest('.enlargeable-image');
    if (img) {
      window.open(img.src, '_blank', 'noopener,noreferrer');
    }
  });
});