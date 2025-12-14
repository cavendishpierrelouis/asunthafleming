const lightbox = document.querySelector(".lightbox");
const lightboxImg = document.querySelector(".lightbox__img");
const closeBtn = document.querySelector(".lightbox__close");


// Open lightbox when clicking any gallery image
document.querySelectorAll(".gallery img").forEach(img => {
img.addEventListener("click", () => {
  lightboxImg.src = img.src;
  lightbox.setAttribute("aria-hidden", "false");
  lightbox.classList.add("open");
});
});


// Close when clicking button or outside image
lightbox.addEventListener("click", e => {
if (e.target === lightbox || e.target === closeBtn) {
  lightbox.classList.remove("open");
  lightbox.setAttribute("aria-hidden", "true");
}
});

  // Drawer logic
  const toggle = document.querySelector('.menu-toggle');
  const drawer = document.getElementById('drawer');
  const links  = drawer.querySelectorAll('.nav-link');


  function openDrawer(){ drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false'); toggle.setAttribute('aria-expanded','true'); }
  function closeDrawer(){ drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); toggle.setAttribute('aria-expanded','false'); }
  toggle.addEventListener('click', () => drawer.classList.contains('open') ? closeDrawer() : openDrawer());
  links.forEach(a => a.addEventListener('click', closeDrawer));
  window.addEventListener('keydown', e => { if(e.key==='Escape') closeDrawer(); });
// SCROLL REVEAL — THIS is the ONLY animation code you keep
const revealObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.18 }
);


document.querySelectorAll('.reveal').forEach(el => {
  revealObserver.observe(el);
});
  // Year
  document.getElementById('year').textContent = new Date().getFullYear();