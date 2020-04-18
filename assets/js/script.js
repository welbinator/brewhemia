let showing = false;
const nav = document.getElementById("nav");

document.getElementById("mobile-icon").addEventListener("click", function () {
	if (showing == false) {
		nav.style.WebkitTransform = "translate(0)";

		showing = true;
		console.log("showing");
	} else {
		nav.style.WebkitTransform = "translateX(100%)";

		showing = false;
		console.log("not showing");
	}
});
