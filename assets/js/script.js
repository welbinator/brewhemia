
let showing = false;

document.getElementById("mobile-icon").addEventListener("click", function() {

    if (showing == false) {
        document.getElementById("nav").style.WebkitTransform = "translate(0)";
        showing = true;
        console.log("showing");
    } else {
        document.getElementById("nav").style.WebkitTransform = "translateX(100%)";
        showing = false;
        console.log("not showing");
    }

   
})