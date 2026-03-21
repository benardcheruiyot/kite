(function () {
    // 1. Disable Right Click
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        return false;
    });

    // 2. Disable Keyboard Shortcuts (F12, Ctrl+Shift+I/J/U/C)
    document.addEventListener('keydown', function (e) {
        // F12
        if (e.key === 'F12' || e.keyCode === 123) {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (Chrome/Firefox DevTools)
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C' || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+U (View Source)
        if (e.ctrlKey && (e.key === 'U' || e.keyCode === 85)) {
            e.preventDefault();
            return false;
        }
    });

    // 3. Debugger Trap (Anti-Debugging)
    // This loops constantly. If DevTools is open, the 'debugger' statement pauses execution,
    // making the page painful to use for an attacker.
    setInterval(function () {
        const startTime = new Date().getTime();
        debugger;
        const endTime = new Date().getTime();

        // If 'debugger' paused execution, time diff will be huge.
        if (endTime - startTime > 100) {
            // Optional: Redirect or clear body
            // document.body.innerHTML = 'Security violation detected.';
        }
    }, 100);

    // 4. Console Clearing (Minor annoyance)
    setInterval(function () {
        console.clear();
        console.log("%cSecurity Active", "color: red; font-size: 20px; font-weight: bold;");
    }, 1000);
})();
