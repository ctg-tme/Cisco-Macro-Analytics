function updateCurrentYear() {
  const today = new Date();
  const currentYear = document.getElementById('currentYear');
  currentYear.innerHTML = today.getFullYear();
}

function adjustBodyMarginForMenu() {
  const menu = document.getElementById('navbarMain');
  if (window.innerWidth <= 1023) {
    if (menu && menu.classList.contains('is-active')) {
      const menuHeight = menu.offsetHeight;
      console.log("Setting margin-top:", menuHeight, "px");
      document.body.style.marginTop = menuHeight + 'px';
    } else {
      console.log("Resetting margin-top");
      document.body.style.marginTop = null;
    }
  } else {
    console.log("Desktop: Resetting margin-top");
    document.body.style.marginTop = null;
  }
}

window.onload = () => {
  updateCurrentYear();
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