// The docs page: "Open in the playground" for every whole example circuit (a share link carrying
// the circuit), and the contents list following the reader.

import { pack } from "./share.js";

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-open]")) {
  b.addEventListener("click", async () => {
    const code = b.parentElement!.querySelector("code")!.textContent ?? "";
    location.href = `./#c=${await pack(code)}`;
  });
}

// Mark the section being read in the contents list.
const links = new Map([...document.querySelectorAll<HTMLAnchorElement>(".toc a")].map((a) => [a.hash.slice(1), a]));
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    for (const a of links.values()) a.classList.remove("here");
    links.get(e.target.id)?.classList.add("here");
  }
}, { rootMargin: "-20% 0px -70% 0px" });
for (const id of links.keys()) {
  const el = document.getElementById(id);
  if (el) seen.observe(el);
}
