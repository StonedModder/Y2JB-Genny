    window.setSystemStatus = function(message, type="info") {
        const status = document.getElementById("systemStatus");
        if (!status || typeof message !== "string") {
            return;
        }

        const normalized = message
            .replace(/^\[[^\]]+\]\s*/, "")
            .replace(/\.+$/, "")
            .trim()
            .toUpperCase();

        if (!normalized) {
            return;
        }

        const typeClass = {
            error: "cyber-text-glow--magenta",
            success: "cyber-text-glow--green",
            warning: "cyber-text-glow--yellow",
            info: "cyber-text-glow"
        }[type] || "cyber-text-glow";

        const typeColor = {
            error: "#ff2a6d",
            success: "#05ffa1",
            warning: "#fcee0a",
            info: "#00f0ff"
        }[type] || "#00f0ff";

        status.className = "cyber-glitch host-effects-title " + typeClass;
        status.style.color = typeColor;
        status.style.textShadow = "0 0 13px " + typeColor + ", 2px 0 0 rgba(255,42,109,0.65), -2px 0 0 rgba(5,255,161,0.45)";
        status.dataset.text = normalized;
        status.textContent = normalized;
    };

    function isStageStatus(message, type) {
        if (type === "warning" || type === "error") {
            return true;
        }

        if (typeof message !== "string") {
            return false;
        }

        return /running|chain|primitive|kernel|autoload|payload|finished|ready/i.test(message);
    }

    function applyStyles(element, styles) {
        for (const key in styles) {
            if (Object.prototype.hasOwnProperty.call(styles, key)) {
                element.style[key] = styles[key];
            }
        }
    }

    function setKernelVisualMode(enabled) {
        const ui = document.getElementById("autoloader_ui");
        if (!ui) {
            return;
        }

        if (enabled) {
            if (ui.className.indexOf("host-kernel-mode") === -1) {
                ui.className += " host-kernel-mode";
            }
        } else {
            ui.className = ui.className.replace(/\s*host-kernel-mode/g, "");
        }

        const criticalIds = [
            "systemStatus",
            "moduleGrid",
            "moduleValue0",
            "moduleValue1",
            "moduleValue2",
            "moduleFill0",
            "moduleFill1",
            "moduleFill2"
        ];

        for (let i = 0; i < criticalIds.length; i++) {
            const element = document.getElementById(criticalIds[i]);
            if (element) {
                element.style.visibility = "visible";
                element.style.opacity = "1";
            }
        }
    }

    window.autoloader_ui = function() {
        if (document.getElementById("autoloader_ui")) {
            const existing_ui = document.getElementById("autoloader_ui");
            existing_ui.parentNode.removeChild(existing_ui);
        }

        const baseWidth = 1920;
        const baseHeight = 1080;
        const scale = Math.min(window.innerWidth / baseWidth, window.innerHeight / baseHeight);

        const autoloader_ui = document.createElement("div");
        autoloader_ui.id = "autoloader_ui";
        autoloader_ui.className = "xmb-shell";
        applyStyles(autoloader_ui, {
            position: "fixed",
            top: "0px",
            left: "0px",
            width: baseWidth + "px",
            height: baseHeight + "px",
            transform: "scale(" + scale + ")",
            transformOrigin: "top left",
            zIndex: "9999",
            overflow: "hidden",
            backgroundColor: "#060810",
            backgroundImage: "radial-gradient(ellipse at 50% 100%, rgba(252,238,10,0.07) 0%, transparent 55%), radial-gradient(ellipse at 20% 60%, rgba(255,42,109,0.06) 0%, transparent 35%), radial-gradient(ellipse at 80% 60%, rgba(0,240,255,0.05) 0%, transparent 35%)",
            color: "#fcee0a",
            fontFamily: "'Courier New', Consolas, monospace"
        });

        const waveOne = document.createElement("div");
        waveOne.className = "xmb-wave xmb-wave--one";
        autoloader_ui.appendChild(waveOne);

        const waveTwo = document.createElement("div");
        waveTwo.className = "xmb-wave xmb-wave--two";
        autoloader_ui.appendChild(waveTwo);

        const topBar = document.createElement("div");
        topBar.className = "xmb-topbar";
        applyStyles(topBar, {
            position: "absolute",
            top: "18px",
            left: "56px",
            width: "1808px",
            height: "70px",
            color: "#fff",
            fontSize: "24px",
            lineHeight: "70px",
            textShadow: "0 2px 8px rgba(0,0,0,0.55)"
        });
        autoloader_ui.appendChild(topBar);

        const brand = document.createElement("div");
        brand.textContent = autoloader_version;
        applyStyles(brand, {
            position: "absolute",
            top: "0px",
            left: "0px",
            width: "142px",
            height: "70px",
            color: "#fcee0a",
            fontSize: "34px",
            fontWeight: "700",
            letterSpacing: "2px",
            textShadow: "0 0 14px rgba(252,238,10,0.7)"
        });
        topBar.appendChild(brand);

        const credit = document.createElement("div");
        credit.textContent = "StonedModder";
        applyStyles(credit, {
            position: "absolute",
            top: "0px",
            left: "156px",
            width: "360px",
            height: "70px",
            color: "rgba(252,238,10,0.65)",
            fontSize: "22px",
            letterSpacing: "1px"
        });
        topBar.appendChild(credit);

        const sonicBadge = document.createElement("div");
        sonicBadge.textContent = "Y2Genny";
        applyStyles(sonicBadge, {
            position: "absolute",
            top: "14px",
            left: "530px",
            height: "42px",
            padding: "0 18px",
            color: "#fcee0a",
            backgroundColor: "rgba(252,238,10,0.08)",
            border: "1px solid rgba(252,238,10,0.40)",
            fontSize: "18px",
            fontWeight: "700",
            letterSpacing: "3px",
            lineHeight: "42px",
            textTransform: "uppercase",
            textShadow: "0 0 10px rgba(252,238,10,0.6)",
            boxShadow: "0 0 12px rgba(252,238,10,0.20)"
        });
        topBar.appendChild(sonicBadge);

        const version = document.createElement("div");
        version.textContent = "OFFLINE";
        applyStyles(version, {
            position: "absolute",
            top: "0px",
            right: "186px",
            width: "120px",
            height: "70px",
            color: "#00f0ff",
            textAlign: "right",
            fontSize: "22px",
            letterSpacing: "2px",
            textShadow: "0 0 10px rgba(0,240,255,0.6)"
        });
        topBar.appendChild(version);

        const clock = document.createElement("div");
        clock.textContent = "Y2JB";
        applyStyles(clock, {
            position: "absolute",
            top: "0px",
            right: "0px",
            width: "170px",
            height: "70px",
            color: "#fcee0a",
            textAlign: "right",
            fontSize: "22px",
            fontWeight: "700",
            letterSpacing: "3px",
            textShadow: "0 0 14px rgba(252,238,10,0.7)"
        });
        topBar.appendChild(clock);

        const status = document.createElement("div");
        status.id = "systemStatus";
        status.textContent = "STANDING BY";
        status.dataset.text = "STANDING BY";
        status.className = "xmb-status";
        applyStyles(status, {
            position: "absolute",
            top: "104px",
            left: "76px",
            width: "1768px",
            height: "48px",
            color: "#fcee0a",
            fontSize: "26px",
            lineHeight: "48px",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            fontWeight: "700",
            letterSpacing: "6px",
            textShadow: "0 0 16px rgba(252,238,10,0.7), 0 0 40px rgba(252,238,10,0.3)"
        });
        autoloader_ui.appendChild(status);

        const moduleGrid = document.createElement("div");
        moduleGrid.id = "moduleGrid";
        moduleGrid.className = "xmb-ribbon";
        applyStyles(moduleGrid, {
            position: "absolute",
            top: "190px",
            left: "80px",
            width: "1760px",
            height: "246px",
            overflow: "hidden"
        });
        autoloader_ui.appendChild(moduleGrid);

        // Pipeline stages - animations via host-ui.css classes (no style injection)
        var stageLabels  = ["USERLAND",  "KERNEL",          "PAYLOAD",    "AUTOLOAD",     "COMPLETE"  ];
        var stageSubs    = ["EXPLOIT INIT","PRIV ESCALATION","ELF LOADER", "MANIFEST EXEC","SYSTEM READY"];
        var stageBoxes   = [];
        var stageDots    = [];
        var stageLbls    = [];
        var stageSts     = [];
        var stageArrows  = [];

        var SW = 238, AW = 110, SH = 170;
        var pipeW = stageLabels.length * SW + (stageLabels.length - 1) * AW;
        var pipeX = Math.floor((1760 - pipeW) / 2);
        var pipeY = Math.floor((246 - SH) / 2);

        for (var si = 0; si < stageLabels.length; si++) {
            var sx = pipeX + si * (SW + AW);

            var sbox = document.createElement("div");
            applyStyles(sbox, {
                position: "absolute",
                top: pipeY + "px",
                left: sx + "px",
                width: SW + "px",
                height: SH + "px",
                border: "1px solid rgba(252,238,10,0.15)",
                backgroundColor: "rgba(6,8,16,0.92)",
                boxSizing: "border-box",
                overflow: "hidden"
            });

            var snum = document.createElement("div");
            applyStyles(snum, {
                position: "absolute",
                top: "12px",
                left: "14px",
                color: "rgba(252,238,10,0.28)",
                fontSize: "11px",
                fontWeight: "700",
                letterSpacing: "1px"
            });
            snum.textContent = "0" + (si + 1);
            sbox.appendChild(snum);

            var sdot = document.createElement("div");
            applyStyles(sdot, {
                position: "absolute",
                top: "17px",
                right: "14px",
                width: "9px",
                height: "9px",
                borderRadius: "50%",
                backgroundColor: "rgba(252,238,10,0.12)"
            });
            sbox.appendChild(sdot);

            var slbl = document.createElement("div");
            applyStyles(slbl, {
                position: "absolute",
                top: "52px",
                left: "0",
                width: SW + "px",
                textAlign: "center",
                fontSize: "19px",
                fontWeight: "700",
                letterSpacing: "5px",
                color: "rgba(252,238,10,0.22)",
                textTransform: "uppercase"
            });
            slbl.textContent = stageLabels[si];
            sbox.appendChild(slbl);

            var ssub = document.createElement("div");
            applyStyles(ssub, {
                position: "absolute",
                top: "84px",
                left: "0",
                width: SW + "px",
                textAlign: "center",
                fontSize: "10px",
                letterSpacing: "3px",
                color: "rgba(252,238,10,0.14)",
                textTransform: "uppercase"
            });
            ssub.textContent = stageSubs[si];
            sbox.appendChild(ssub);

            var sst = document.createElement("div");
            applyStyles(sst, {
                position: "absolute",
                bottom: "12px",
                left: "0",
                width: SW + "px",
                textAlign: "center",
                fontSize: "10px",
                letterSpacing: "3px",
                color: "rgba(252,238,10,0.16)",
                textTransform: "uppercase"
            });
            sst.textContent = "PENDING";
            sbox.appendChild(sst);

            moduleGrid.appendChild(sbox);
            stageBoxes.push(sbox);
            stageDots.push(sdot);
            stageLbls.push(slbl);
            stageSts.push(sst);

            if (si < stageLabels.length - 1) {
                var sarr = document.createElement("div");
                applyStyles(sarr, {
                    position: "absolute",
                    top: (pipeY + Math.floor(SH / 2) - 16) + "px",
                    left: (sx + SW) + "px",
                    width: AW + "px",
                    height: "32px",
                    textAlign: "center",
                    lineHeight: "32px",
                    color: "rgba(252,238,10,0.15)",
                    fontSize: "22px",
                    letterSpacing: "-4px",
                    userSelect: "none",
                    pointerEvents: "none"
                });
                sarr.textContent = ">>>";
                moduleGrid.appendChild(sarr);
                stageArrows.push(sarr);
            }
        }

        window.setActiveStage = function(activeIndex) {
            for (var i = 0; i < stageBoxes.length; i++) {
                var b  = stageBoxes[i];
                var d  = stageDots[i];
                var l  = stageLbls[i];
                var st = stageSts[i];
                if (i < activeIndex) {
                    b.className = "";
                    b.style.border = "1px solid rgba(0,240,255,0.38)";
                    b.style.boxShadow = "0 0 10px rgba(0,240,255,0.12)";
                    l.style.color = "rgba(0,240,255,0.70)";
                    d.style.backgroundColor = "#00f0ff";
                    d.style.boxShadow = "0 0 8px rgba(0,240,255,0.8)";
                    d.className = "";
                    st.style.color = "rgba(0,240,255,0.55)";
                    st.textContent = "DONE";
                } else if (i === activeIndex) {
                    b.className = "nc-stage-active";
                    b.style.border = "1px solid #fcee0a";
                    b.style.boxShadow = "";
                    l.style.color = "#fcee0a";
                    d.style.backgroundColor = "#fcee0a";
                    d.style.boxShadow = "0 0 10px rgba(252,238,10,0.9)";
                    d.className = "nc-dot-live";
                    st.style.color = "rgba(252,238,10,0.80)";
                    st.textContent = "RUNNING...";
                } else {
                    b.className = "";
                    b.style.border = "1px solid rgba(252,238,10,0.12)";
                    b.style.boxShadow = "";
                    l.style.color = "rgba(252,238,10,0.20)";
                    d.style.backgroundColor = "rgba(252,238,10,0.10)";
                    d.style.boxShadow = "";
                    d.className = "";
                    st.style.color = "rgba(252,238,10,0.14)";
                    st.textContent = "PENDING";
                }
                if (i < stageArrows.length) {
                    if (i < activeIndex) {
                        stageArrows[i].className = "";
                        stageArrows[i].style.color = "rgba(0,240,255,0.45)";
                    } else if (i === activeIndex) {
                        stageArrows[i].className = "nc-arrow-live";
                        stageArrows[i].style.color = "rgba(252,238,10,0.75)";
                    } else {
                        stageArrows[i].className = "";
                        stageArrows[i].style.color = "rgba(252,238,10,0.12)";
                    }
                }
            }
        };

        window.setActiveStage(0);

        const detailTitle = document.createElement("div");
        detailTitle.textContent = "Y2JB // Y2Genny";
        applyStyles(detailTitle, {
            position: "absolute",
            top: "448px",
            left: "92px",
            width: "820px",
            height: "54px",
            fontSize: "30px",
            lineHeight: "54px",
            fontWeight: "700",
            letterSpacing: "4px",
            color: "#fcee0a",
            textTransform: "uppercase",
            textShadow: "0 0 18px rgba(252,238,10,0.65), 0 0 40px rgba(252,238,10,0.25)"
        });
        autoloader_ui.appendChild(detailTitle);

        const detailText = document.createElement("div");
        detailText.textContent = "Y2JB Autoloader v0.6.3-e655073 by PLK // Offline PS5 Exploit Chain";
        applyStyles(detailText, {
            position: "absolute",
            top: "506px",
            left: "94px",
            width: "820px",
            height: "34px",
            fontSize: "16px",
            lineHeight: "34px",
            letterSpacing: "2px",
            color: "rgba(252,238,10,0.50)",
            textShadow: "none"
        });
        autoloader_ui.appendChild(detailText);

        const modules = [
            ["EXPLOIT CHAIN", "INITIALIZING", "#fcee0a"],
            ["KERNEL STAGE", "STANDING BY", "#ff2a6d"],
            ["PAYLOAD RUNNER", "QUEUE READY", "#00f0ff"]
        ];

        modules.forEach((moduleInfo, index) => {
            const card = document.createElement("div");
            applyStyles(card, {
                position: "absolute",
                top: (570 + index * 86) + "px",
                left: "94px",
                width: "760px",
                height: "66px",
                backgroundColor: "rgba(6,8,16,0.92)",
                border: "1px solid rgba(252,238,10,0.18)",
                borderLeft: "3px solid #fcee0a",
                boxShadow: "0 0 16px rgba(252,238,10,0.06)",
                overflow: "hidden"
            });
            autoloader_ui.appendChild(card);

            const moduleLabel = document.createElement("div");
            moduleLabel.textContent = moduleInfo[0];
            applyStyles(moduleLabel, {
                position: "absolute",
                top: "8px",
                left: "18px",
                width: "230px",
                height: "22px",
                color: "rgba(252,238,10,0.50)",
                fontSize: "11px",
                lineHeight: "22px",
                letterSpacing: "3px",
                textTransform: "uppercase"
            });
            card.appendChild(moduleLabel);

            const moduleValue = document.createElement("div");
            moduleValue.id = "moduleValue" + index;
            moduleValue.textContent = moduleInfo[1];
            applyStyles(moduleValue, {
                position: "absolute",
                top: "30px",
                left: "18px",
                width: "420px",
                height: "26px",
                color: "#fcee0a",
                fontSize: "14px",
                fontWeight: "700",
                letterSpacing: "2px",
                lineHeight: "26px",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                textShadow: "0 0 8px rgba(252,238,10,0.5)"
            });
            card.appendChild(moduleValue);

            const moduleMeter = document.createElement("div");
            applyStyles(moduleMeter, {
                position: "absolute",
                top: "28px",
                right: "18px",
                width: "230px",
                height: "10px",
                backgroundColor: "rgba(255,255,255,0.04)",
                overflow: "hidden"
            });
            card.appendChild(moduleMeter);

            const moduleFill = document.createElement("div");
            moduleFill.id = "moduleFill" + index;
            applyStyles(moduleFill, {
                width: index === 0 ? "12%" : (index === 1 ? "8%" : "24%"),
                height: "100%",
                backgroundColor: moduleInfo[2],
                boxShadow: "0 0 8px " + moduleInfo[2]
            });
            moduleMeter.appendChild(moduleFill);
        });

        const logWrapper = document.createElement("div");
        logWrapper.id = "logWrapper";
        logWrapper.className = "xmb-log";
        applyStyles(logWrapper, {
            position: "absolute",
            top: "448px",
            left: "940px",
            width: "860px",
            height: "410px",
            backgroundColor: "rgba(6,8,16,0.96)",
            border: "1px solid rgba(252,238,10,0.18)",
            borderLeft: "3px solid #fcee0a",
            boxShadow: "0 0 20px rgba(252,238,10,0.07)",
            overflow: "hidden"
        });
        autoloader_ui.appendChild(logWrapper);

        const logHeader = document.createElement("div");
        logHeader.textContent = "// EVENT STREAM";
        applyStyles(logHeader, {
            position: "absolute",
            top: "0px",
            left: "0px",
            width: "860px",
            height: "48px",
            paddingLeft: "20px",
            boxSizing: "border-box",
            color: "#fcee0a",
            backgroundColor: "rgba(252,238,10,0.07)",
            fontSize: "16px",
            fontWeight: "700",
            letterSpacing: "4px",
            lineHeight: "48px",
            textTransform: "uppercase",
            textShadow: "0 0 10px rgba(252,238,10,0.5)"
        });
        logWrapper.appendChild(logHeader);

        const logContainer = document.createElement("div");
        logContainer.id = "logContainer";
        applyStyles(logContainer, {
            position: "absolute",
            top: "49px",
            left: "0px",
            width: "860px",
            height: "361px",
            padding: "14px 18px",
            boxSizing: "border-box",
            color: "rgba(252,238,10,0.75)",
            overflowX: "hidden",
            overflowY: "scroll",
            fontFamily: "Lucida Console, Consolas, Courier New, monospace",
            fontSize: "18px",
            lineHeight: "28px"
        });
        logWrapper.appendChild(logContainer);

        const progressBarContainer = document.createElement("div");
        progressBarContainer.id = "progressBarContainer";
        applyStyles(progressBarContainer, {
            position: "absolute",
            top: "902px",
            left: "94px",
            width: "1706px",
            height: "64px",
            backgroundColor: "rgba(6,8,16,0.92)",
            border: "1px solid rgba(252,238,10,0.22)",
            borderTop: "2px solid #fcee0a",
            overflow: "hidden",
            boxShadow: "0 0 20px rgba(252,238,10,0.10)"
        });
        autoloader_ui.appendChild(progressBarContainer);

        const progressBar = document.createElement("div");
        progressBar.id = "progressBar";
        applyStyles(progressBar, {
            position: "absolute",
            top: "0px",
            left: "0px",
            width: "100%",
            height: "100%",
            backgroundColor: "#fcee0a",
            boxShadow: "0 0 18px rgba(252,238,10,0.6)",
            transformOrigin: "left",
            transform: "scaleX(0)",
            transition: "transform 0.35s ease-in-out"
        });
        progressBarContainer.appendChild(progressBar);

        const progressLabel = document.createElement("div");
        progressLabel.id = "progressLabel";
        progressLabel.textContent = "Loading...";
        applyStyles(progressLabel, {
            position: "absolute",
            top: "0px",
            left: "0px",
            width: "1706px",
            height: "64px",
            color: "rgba(252,238,10,0.85)",
            fontSize: "18px",
            fontWeight: "700",
            letterSpacing: "3px",
            lineHeight: "64px",
            textAlign: "center",
            textTransform: "uppercase",
            textShadow: "0 0 10px rgba(252,238,10,0.4)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis"
        });
        progressBarContainer.appendChild(progressLabel);

        document.body.appendChild(autoloader_ui);
    };

    window.updateProgress = function(percent, message="Loading...") {
        setKernelVisualMode(percent >= 20 && percent < 50);
        if (typeof window.setActiveStage === 'function') {
            window.setActiveStage(percent < 20 ? 0 : percent < 40 ? 1 : percent < 60 ? 2 : percent < 85 ? 3 : 4);
        }

        const progressBarContainer = document.getElementById("progressBarContainer");
        if (progressBarContainer) {
            progressBarContainer.style.setProperty('--progress-value', percent + '%');
        }
        const progressBar = document.getElementById("progressBar");
        if (progressBar) {
            progressBar.style.width = '100%';
            progressBar.style.transform = 'scaleX(' + (percent / 100) + ')';
        }
        const progressLabel = document.getElementById("progressLabel");
        if (progressLabel) {
            progressLabel.textContent = message;
        }
        window.setSystemStatus(message, "warning");
        window.uiLog(message, "warning");

        const moduleValue0 = document.getElementById("moduleValue0");
        const moduleFill0 = document.getElementById("moduleFill0");
        const moduleValue1 = document.getElementById("moduleValue1");
        const moduleFill1 = document.getElementById("moduleFill1");
        const moduleValue2 = document.getElementById("moduleValue2");
        const moduleFill2 = document.getElementById("moduleFill2");
        if (moduleValue0) {
            moduleValue0.textContent = message;
        }
        if (moduleFill0) {
            moduleFill0.style.width = Math.min(100, Math.max(12, percent * 3)) + "%";
        }
        if (moduleValue1 && percent >= 20) {
            moduleValue1.textContent = message;
        }
        if (moduleFill1) {
            moduleFill1.style.width = Math.min(100, Math.max(8, (percent - 20) * 3)) + "%";
        }
        if (moduleValue2 && percent >= 50) {
            moduleValue2.textContent = message;
        }
        if (moduleFill2) {
            moduleFill2.style.width = Math.min(100, Math.max(24, (percent - 50) * 2)) + "%";
        }
    };

    window.uiLog = function(message, type="info") {
        if (typeof message === 'string' && (message.includes("[ERROR]") || message.includes("[-]"))) {
            if (typeof window.hideUI === 'function') window.hideUI();
        }
        const logContainer = document.getElementById("logContainer");
        if (logContainer) {
            const logEntry = document.createElement("div");
            const typeClass = {
                error: "cyber-text-magenta",
                success: "cyber-text-green",
                warning: "cyber-text-yellow",
                info: "cyber-text-secondary"
            }[type] || "cyber-text-secondary";
            logEntry.className = "host-log-entry " + typeClass;
            logEntry.textContent = message;
            applyStyles(logEntry, {
                width: "806px",
                height: "30px",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                fontSize: "22px",
                lineHeight: "30px",
                color: type === "error" ? "#ff2a6d" : (type === "success" ? "#fcee0a" : (type === "warning" ? "#00f0ff" : "rgba(252,238,10,0.60)")),
                textShadow: type === "error" ? "0 0 8px rgba(255,42,109,0.5)" : (type === "success" ? "0 0 8px rgba(252,238,10,0.5)" : "none")
            });
            logContainer.appendChild(logEntry);
            if (isStageStatus(message, type)) {
                window.setSystemStatus(message, type);
            }
            if (logContainer.childElementCount > 20) {
                logContainer.removeChild(logContainer.firstChild);
            }
            const logWrapper = document.getElementById("logWrapper");
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    };

    window.hideUI = function() {
        if (document.getElementById("autoloader_ui")) {
            const existing_ui = document.getElementById("autoloader_ui");
            existing_ui.parentNode.removeChild(existing_ui);
        }
    };
