const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("heroDate").textContent = new Intl.DateTimeFormat("en-IN", {weekday:"long", month:"long", day:"numeric"}).format(new Date());

const authModal = $("#authModal");
let authMode = "login";

function openAuth(mode="login"){
  authMode = mode;
  authModal.classList.add("open");
  setTimeout(() => authModal.querySelector(mode === "signup" ? "input[name=name]" : "input[name=email]").focus(), 50);
  authModal.setAttribute("aria-hidden","false");
  updateAuthUI();
}
document.addEventListener("keydown", e => {if(e.key === "Escape") closeAuth();});
function closeAuth(){
  authModal.classList.remove("open");
  authModal.setAttribute("aria-hidden","true");
}
function updateAuthUI(){
  const signup = authMode === "signup";
  $("#authEyebrow").textContent = signup ? "CREATE YOUR SPACE" : "WELCOME BACK";
  $("#authTitle").textContent = signup ? "Start your LifeBox" : "Log in to LifeBox";
  $("#authSubtitle").textContent = signup ? "Create a personal space for everything important." : "Access your personal control center.";
  $("#nameField").classList.toggle("hidden", !signup);
  $("#nameField input").required = signup;
  $("#authSubmit").textContent = signup ? "Create account ↗" : "Log in ↗";
  $("#switchAuth").textContent = signup ? "Already have an account? Log in" : "Need an account? Sign up";
  $("#authStatus").textContent = "";
  $("#authForm").elements.password.autocomplete = signup ? "new-password" : "current-password";
}
$$("[data-open-auth]").forEach(b => b.addEventListener("click", () => openAuth(b.dataset.openAuth)));
$$("[data-close-modal]").forEach(b => b.addEventListener("click", closeAuth));
$("#switchAuth").addEventListener("click", () => {authMode = authMode === "login" ? "signup" : "login"; updateAuthUI();});
authModal.addEventListener("click", e => {if(e.target === authModal) closeAuth();});

async function api(url, method="GET", body){
  const res = await fetch(url, {method, headers: body ? {"Content-Type":"application/json"} : {}, body: body ? JSON.stringify(body) : undefined, credentials:"same-origin"});
  let data = {};
  try { data = await res.json(); } catch {}
  if(!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
function setNote(el, text, kind){ el.textContent = text; el.className = "form-note" + (kind ? " " + kind : ""); }

$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const status = $("#authStatus");
  const btn = $("#authSubmit");
  const signup = authMode === "signup";
  if(signup && !data.name.trim()) return setNote(status, "Enter your name.", "error");
  if(!data.email.trim()) return setNote(status, "Enter your email address.", "error");
  if(signup && data.password.length < 8) return setNote(status, "Password must be at least 8 characters.", "error");
  if(!data.password) return setNote(status, "Enter your password.", "error");
  btn.disabled = true; setNote(status, signup ? "Creating your account…" : "Logging in…");
  try{
    await api(signup ? "/api/auth/register" : "/api/auth/login", "POST", data);
    setNote(status, "Success. Opening your dashboard…", "ok");
    window.location.href = "/dashboard";
  }catch(err){
    setNote(status, err.message, "error");
    btn.disabled = false;
  }
});

(async function checkSession(){
  try{
    const {user} = await api("/api/auth/me");
    $("#heroName").textContent = user.name.split(" ")[0];
    $("#navLogin").classList.add("hidden");
    $("#navSignup").classList.add("hidden");
    $("#navDash").classList.remove("hidden");
    $(".nav-login-mobile")?.remove();
    const cta = $("#heroCta");
    cta.textContent = "Open your dashboard ↗";
    cta.replaceWith(Object.assign(cta.cloneNode(true), {onclick: () => location.href = "/dashboard"}));
  }catch{
    if(new URLSearchParams(location.search).get("login")) openAuth("login");
  }
})();

$("#contactForm").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target, note = $("#contactStatus"), btn = form.querySelector("button[type=submit]");
  const data = Object.fromEntries(new FormData(form));
  if(!data.name.trim() || !data.email.trim() || !data.message.trim()) return setNote(note, "Fill in your name, email and message.", "error");
  btn.disabled = true; setNote(note, "Sending…");
  try{
    await api("/api/contact", "POST", data);
    setNote(note, "Message sent. Thank you, the owner will reply by email.", "ok");
    form.reset();
  }catch(err){
    setNote(note, err.message, "error");
  }finally{ btn.disabled = false; }
});

const menuToggle = $("#menuToggle"), navLinks = $(".nav-links");
menuToggle.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", open);
});
navLinks.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {navLinks.classList.remove("open"); menuToggle.setAttribute("aria-expanded","false");}));

if(window.gsap){
  gsap.registerPlugin(ScrollTrigger);
  gsap.from(".navbar", {y:-30, opacity:0, duration:1, ease:"power3.out"});
  gsap.from(".hero-copy > *", {y:35, opacity:0, duration:1, stagger:.09, delay:.2, ease:"power3.out"});
  gsap.to(".orb-one", {x:25, y:-25, duration:5, repeat:-1, yoyo:true, ease:"sine.inOut"});
  gsap.to(".orb-two", {x:-20, y:25, duration:6, repeat:-1, yoyo:true, ease:"sine.inOut"});
  gsap.to(".dashboard-card", {y:-12, duration:4, repeat:-1, yoyo:true, ease:"sine.inOut"});
  gsap.utils.toArray(".reveal").forEach(el => {
    gsap.from(el, {scrollTrigger:undefined, y:30, opacity:0, duration:.8, delay:.05, ease:"power2.out",
      scrollTrigger:{trigger:el, start:"top 88%", once:true}});
  });
}
$$(".tilt-card").forEach(card => {
  card.addEventListener("pointermove", e => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
    card.style.transform = `perspective(900px) rotateY(${x*8}deg) rotateX(${-y*8}deg)`;
  });
  card.addEventListener("pointerleave", () => card.style.transform = "");
});
