let showing = false;
const nav = document.getElementById("nav");
let activeMenuItems;
let MenuItems = document.querySelectorAll("nav ul li");
let num = 100;
let increment;
mobileMenuInit();

window.addEventListener("resize", mobileMenuInit);

function mobileMenuInit() {
	if (window.innerWidth < 969) {
		console.log("small screen");
		addNavActive();

		menuAnimationOut();
	} else {
		console.log("big scren");
		removeNavActive();
		menuAnimationIn();
	}
}

function addNavActive() {
	nav.classList.add("active");
	activeMenuItems = document.querySelectorAll("nav.active ul li");
}

function removeNavActive() {
	nav.classList.remove("active");
}

document.getElementById("mobile-icon").addEventListener("click", function () {
	if (showing == false) {
		nav.style.WebkitTransform = "translate(0)";
		nav.classList.add("active");
		menuItems = document.querySelectorAll("nav.active ul li");

		menuAnimationIn();
		showing = true;
	} else {
		nav.style.WebkitTransform = "translateX(100%)";
		nav.classList.remove("active");
		menuAnimationOut();

		showing = false;
	}
});

// menu animation

function menuAnimationOut() {
	console.log("out!");
	console.log(activeMenuItems);
	activeMenuItems.forEach((item) => {
		increment = num + "%";
		num += 20;
		item.style.transform = `translateX(${increment})`;
	});
}

function menuAnimationIn() {
	num = 100;

	menuItems.forEach((item) => {
		item.style.transform = "translateX(0)";
	});
}
