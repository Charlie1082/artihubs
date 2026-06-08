const form = document.querySelector("form");

if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    alert("Thank you. Artihubs will follow up from hello@artihubs.com.");
  });
}
