/*
=========================================
본문높이 자동 채우기
=========================================
*/
function autoBodyHeight() {
    // 1) 뷰포트 전체 높이
    var docH = $(window).height();

    // 2) 헤더(.header-gnb) 높이 + 하단 여백 30px
    var headH = ($(".header-gnb").length ? $(".header-gnb").outerHeight() : 0) + 30;

    // 3) 본문(section) 높이 계산
    var bodyH = docH - headH;

    // 4) section 요소들에 높이 적용
    $("section").css("height", bodyH + "px");
}

// 윈도우 로드 & 리사이즈 시 실행
$(window).on("load resize", autoBodyHeight);

/*
=========================================
일반 & 다크모드 전환
=========================================
*/
$(function () {
    const storageKey = "dark-mode-enabled";
    const $html = $("html");
    const $body = $("body");
    const $whiteBtn = $(".mode-toggle.white");
    const $darkBtn = $(".mode-toggle.dark");

    // 1) 페이지 로드 시 저장된 모드 적용
    if (localStorage.getItem(storageKey) === "true") {
        $html.addClass("dark-mode");
        $body.addClass("dark-mode");
        $darkBtn.attr("title", "선택됨");
        $whiteBtn.removeAttr("title");
    } else {
        $whiteBtn.attr("title", "선택됨");
        $darkBtn.removeAttr("title");
    }

    // 2) white 버튼 클릭: 다크모드 해제
    $whiteBtn.on("click", function () {
        $html.removeClass("dark-mode");
        $body.removeClass("dark-mode");
        localStorage.removeItem(storageKey);

        // title 처리
        $whiteBtn.attr("title", "선택됨");
        $darkBtn.removeAttr("title");
    });

    // 3) dark 버튼 클릭: 다크모드 적용
    $darkBtn.on("click", function () {
        $html.addClass("dark-mode");
        $body.addClass("dark-mode");
        localStorage.setItem(storageKey, "true");

        // title 처리
        $darkBtn.attr("title", "선택됨");
        $whiteBtn.removeAttr("title");
    });
});

/*
=========================================
헤더 좌측 뎁스메뉴 토글
=========================================
*/
$(document).on("click", ".header-lnb .lnb-body .toggle", function () {
    const $li = $(this).closest("li");
    if (!$li.length) return;

    $li.toggleClass("active").siblings().removeClass("active");
});

/*
=========================================
헤더 좌측 뎁스메뉴 상세 탭 클릭
=========================================
*/
$(document).on("click", ".header-lnb .lnb-body a", function () {
    const $parentDd = $(this).closest("dd");
    if (!$parentDd.length) return;

    $parentDd.addClass("active").siblings("dd").removeClass("active");
	
	$(this).attr("title", "선택됨");
	$parentDd.siblings().find("a").removeAttr("title");
});

/*
=========================================
// 작업물 진행상황 URL 호버 시 iframe 처리
=========================================
*/
$(function () {
    $(".link").on("mouseenter", function () {
        const href = $(this).attr("href");
        if (!href) return;

        $(".guide-iframe-box").remove();

        const $iframeBox = $("<div>", {
            class: "guide-iframe-box active",
            css: {
                position: "absolute",
                pointerEvents: "inherit",
                opacity: "1",
                transition: "all ease 0.5s",
                overflow: "hidden",
                left: "15px",
                top: "15px"
            }
        });

        const $iframe = $("<iframe>", {
            src: href,
            title: "URL 미리보기 제공",
            frameborder: 0,
            css: {
                width: "100%",
                height: "100%",
                objectFit: "cover",
                border: "none"
            }
        });

        $iframeBox.append($iframe);
        $("section").first().after($iframeBox);

        const removeBox = () => $iframeBox.remove();
        $(this).on("mouseleave", removeBox);
        $iframeBox.on("mouseleave", removeBox);
    });
});

/*
=========================================
작업현황 카운트 처리
=========================================
*/
function setText(selector, value) {
    $(selector).text(value);
}

function updateStatusCountsFromDOM($context = $(document)) {
    const $allRows = $context.find(".guide-table-box tbody tr");
    if ($allRows.length === 0) return false; // 처리할 내용 없음

    const holdCount = $context.find(".guide-table-box tbody tr.not").length;
    const doneCount = $context.find(".guide-table-box tbody tr.done").length;
    const total = $allRows.length;
    const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    setText(".count-1", total);
    setText(".count-2", holdCount);
    setText(".count-3", doneCount);
    setText(".count-4", percent);

    return true;
}

$(window).on("load", function () {
    const handled = updateStatusCountsFromDOM();

    if (!handled) {
        const $iframe = $("<iframe>", {
            css: { display: "none" },
            src: "status.html",
            title: "작업현황 데이터를 가져오기 위한 프레임"
        }).appendTo("body");

        $iframe.on("load", function () {
            try {
                const $iframeDoc = $(this).contents();
                const success = updateStatusCountsFromDOM($iframeDoc);
                if (!success) {
                    console.warn("⚠ status.html 내에서도 .guide-table-box를 찾지 못했습니다.");
                }
            } catch (err) {
                console.error("❌ iframe 접근 실패 (도메인 불일치 등):", err);
            }
        });
    }
});
