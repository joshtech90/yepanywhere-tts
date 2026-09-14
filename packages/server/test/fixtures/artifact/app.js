const menu = document.querySelector("#menu");
menu.addEventListener("click", () => {
  const expanded = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(expanded));
  document.querySelector("#navigation").hidden = !expanded;
});
const { saveNote } = await import("./notes.js");
document.querySelector("#save").addEventListener("click", () => {
  saveNote(document.querySelector("#note").value);
  document.querySelector("#result").textContent = "Note saved";
});
const data = await (await fetch("./data.json")).json();
document.querySelector("#result").textContent = `${data.notes} sample notes`;
