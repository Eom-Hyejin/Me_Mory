$(document).ready(function () {
    // 감정지도 내 핀 클릭
    $(document).on("click", ".map-center .center-list a", function () {
        var $parent = $(this).parent("li");

        $parent.addClass("active");
        $parent.siblings().removeClass("active");

        // 클릭 시, 화면 너비가 1200 이하일 경우만 fixed 추가
        if ($(window).width() <= 1200) {
            $("html, body, .map-box").addClass("fixed");
        }
    });

    // 리사이즈 시: 1200 초과로 넘어가면 fixed 제거
    $(window).on("resize", function () {
        if ($(window).width() > 1200) {
            $("html, body, .map-box").removeClass("fixed");
        }
    });

    // 로드 시: 처음부터 1200 초과라면 fixed 제거 (안정성용)
    $(window).on("load", function () {
        if ($(window).width() > 1200) {
            $("html, body, .map-box").removeClass("fixed");
        }
    });
	
	// 감정지도 내 핀 클릭
    $(document).on("click", ".map-right .right-head .close", function () {
		$("html, body, .map-box").removeClass("fixed");
    });
});
	
// full-box 높이 설정 함수
function setFullBoxHeight() {
    if ($(".full-box").length > 0) {
        var winH = $(window).outerHeight();        // 브라우저 전체 높이
        var headerH = $("header").outerHeight();   // header 높이
        var sectionSpacing = 
            parseInt($("section").css("padding-top")) + 
            parseInt($("section").css("padding-bottom")); // section 상·하 padding 합산

        var fullH = winH - headerH - sectionSpacing; // 남은 높이 계산
        var boxH = $(".full-box").outerHeight();     // full-box 현재 높이

        // 기본 설정
        $(".full-box").css("height", fullH + "px").removeClass("auto");

        // 조건: winH가 (boxH + headerH * 2) 보다 작으면 height를 auto로 변경
        if (winH < (boxH + headerH * 2)) {
            $(".full-box").css("height", "auto").addClass("auto");
        }
    }
}

// 리사이즈 시 디바운스 적용
var resizeTimer;
$(window).on("load resize", function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
        setFullBoxHeight();
    }, 100); // 100ms 뒤에 실행 (값이 안정된 후)
});

$(document).ready(function(){
	/*
	=========================================
	공통 함수
	=========================================
	*/
	function updateState($box, value) {
		$box.toggleClass("has-value", !!value);
		$box.toggleClass("success", !!value);
	}

	/*
	=========================================
	input-box 처리
	=========================================
	*/
	$(".input-box").each(function () {
		const $box = $(this);
		const $input = $box.find("input");

		const update = () => updateState($box, $input.val().trim());

		update();
		$input.on("focus", () => $box.addClass("focus"));
		$input.on("blur", () => { $box.removeClass("focus"); update(); });
		$input.on("change", update);
	});
	
	// 입력 이벤트 감지 
	$(".input-box").each(function () {
        const $box = $(this);
        const $input = $box.find("input");

        // input focus 시: focus 클래스 추가, press 제거
        $input.on("focus", function () {
            $box.addClass("focus").removeClass("press");
        });

        // input 입력 시: press 클래스 토글
        $input.on("input", function () {
            if ($input.val().trim() !== "") {
                $box.addClass("press");
            } else {
                $box.removeClass("press");
            }
        });

        // 외부 클릭 시 해당 input-box 에만 focus 제거
        $(document).on("mousedown", function (e) {
            if (!$box.is(e.target) && $box.has(e.target).length === 0) {
                $box.removeClass("focus press");
            }
        });
    });
	
	// 비밀번호 보임&숨김 처리
	$(".password").on("click", function () {
        var $box = $(this).closest(".input-box"); // 부모 input-box
        var $input = $box.find("input"); // 내부 input

        $box.toggleClass("password-on"); // password-on 클래스 토글

        if ($box.hasClass("password-on")) {
            $input.attr("type", "text");
        } else {
            $input.attr("type", "password");
        }
    });
	
	/*
	=========================================
	textarea-box 처리
	=========================================
	*/
	$(".textarea-box").each(function () {
		const $box = $(this);
		const $text = $box.find("textarea");

		const update = () => updateState($box, $text.val().trim());

		update();
		$text.on("focus", () => $box.addClass("focus"));
		$text.on("blur", () => { $box.removeClass("focus"); update(); });
		$text.on("change", update);
	});
	
	$(".textarea-box.textarea-auto-height textarea").each(function() {
        var $textarea = $(this);

        // CSS로 지정된 초기 높이(기본값)
        var baseHeight = $textarea.height();

        // 초기 세팅
        $textarea.height(Math.max(this.scrollHeight, baseHeight));

        // 입력할 때마다 높이 조정
        $textarea.on("input", function() {
            $(this).height(baseHeight); // 일단 기본 높이로 리셋
            $(this).height(Math.max(this.scrollHeight, baseHeight));
        });

        // 엔터 입력 시에도 높이 조정
        $textarea.on("keydown", function(e) {
            if (e.key === "Enter") {
                $(this).height(baseHeight);
                $(this).height(Math.max(this.scrollHeight, baseHeight));
            }
        });
    });

	/*
	=========================================
	select-box 처리
	=========================================
	*/
	$(".select-box").each(function () {
		const $box = $(this);
		const $select = $box.find("select");

		const update = () => updateState($box, $select.val());

		update();
		$select.on("focus", () => $box.addClass("focus"));
		$select.on("blur", () => { $box.removeClass("focus"); update(); });
		$select.on("change", update);
	});

	/*
	=========================================
	quantity-box 수량 증가&감소 처리
	=========================================
	*/
	$(".quantity-box").each(function () {
        const box = $(this);
        const input = box.find("input[type='text']");
        const minusBtn = box.find(".quantity-btn.minus");
        const plusBtn = box.find(".quantity-btn.plus");

        // 버튼 클릭 이벤트
        box.find(".quantity-btn").on("click", function () {
            let value = parseInt(input.val(), 10);
            const min = parseInt(input.attr("min")) || 0;
            const max = parseInt(input.attr("max")) || 9999;

            if (isNaN(value)) value = 0; // value가 비어있을 경우 0으로 설정

            if ($(this).hasClass("minus")) {
                if (value <= min) {
                    // 이미 최소값이면 더 이상 감소 불가
                    alert("최소 수량 이하로 선택할 수 없습니다.");
                    return;
                }
                value -= 1;
            } else if ($(this).hasClass("plus")) {
                if (value >= max) {
                    // 이미 최대값이면 더 이상 증가 불가
                    alert("최대 수량 이상 선택할 수 없습니다.");
                    return;
                }
                value += 1;
            }

            input.val(value);

            // 버튼 상태 갱신
            if (value <= min) {
                minusBtn.addClass("disabled");
            } else {
                minusBtn.removeClass("disabled");
            }

            if (value >= max) {
                plusBtn.addClass("disabled");
            } else {
                plusBtn.removeClass("disabled");
            }
        });

        // 초기 버튼 상태 세팅
        input.trigger("change");
    });

    // input 직접 입력 시 min/max 체크 및 버튼 상태 갱신
    $(document).on("change keyup", ".quantity-box input", function () {
        const input = $(this);
        const box = input.closest(".quantity-box");
        const minusBtn = box.find(".quantity-btn.minus");
        const plusBtn = box.find(".quantity-btn.plus");

        let value = parseInt(input.val(), 10);
        const min = parseInt(input.attr("min")) || 0;
        const max = parseInt(input.attr("max")) || 9999;

        if (isNaN(value)) value = 0;
        if (value < min) value = min;
        if (value > max) value = max;

        input.val(value);

        if (value <= min) {
            minusBtn.addClass("disabled");
        } else {
            minusBtn.removeClass("disabled");
        }

        if (value >= max) {
            plusBtn.addClass("disabled");
        } else {
            plusBtn.removeClass("disabled");
        }
    });

    // input 직접 입력 시 min/max 체크 및 버튼 상태 갱신
    $(document).on("change keyup", ".quantity-box input", function () {
        const input = $(this);
        const box = input.closest(".quantity-box");
        const minusBtn = box.find(".quantity-btn.minus");
        const plusBtn = box.find(".quantity-btn.plus");

        let value = parseInt(input.val(), 10);
        const min = parseInt(input.attr("min")) || 0;
        const max = parseInt(input.attr("max")) || 9999;

        if (isNaN(value)) value = 0;
        if (value < min) value = min;
        if (value > max) value = max;

        input.val(value);

        if (value <= min) {
            minusBtn.addClass("disabled");
        } else {
            minusBtn.removeClass("disabled");
        }

        if (value >= max) {
            plusBtn.addClass("disabled");
        } else {
            plusBtn.removeClass("disabled");
        }
    });

	/*
	=========================================
	dropdown-box 처리 (접근성 포함)
	=========================================
	*/
	$(".dropdown-box").each(function () {
		var $dropBox = $(this);
		var $btn = $dropBox.find(".dropdown-btn");

		function openDrop($btn) {
			var targetId = $btn.attr("aria-controls");
			var $targetDrop = $("#" + targetId);

			$dropBox.addClass("active");
			$btn.attr("aria-expanded", "true");
			$targetDrop.removeAttr("hidden");

			// 다른 드롭다운 닫기
			$(".dropdown-box").not($dropBox).each(function () {
				var $otherBox = $(this);
				var $otherBtn = $otherBox.find(".dropdown-btn");
				var $otherDrop = $("#" + $otherBtn.attr("aria-controls"));

				$otherBox.removeClass("active");
				$otherBtn.attr("aria-expanded", "false");
				$otherDrop.attr("hidden", "hidden");
			});
		}

		function closeDrop($btn) {
			var targetId = $btn.attr("aria-controls");
			var $targetDrop = $("#" + targetId);

			$dropBox.removeClass("active");
			$btn.attr("aria-expanded", "false");
			$targetDrop.attr("hidden", "hidden");
		}

		// 버튼 클릭 시 토글
		$btn.on("click", function (e) {
			e.preventDefault();
			if ($dropBox.hasClass("active")) {
				closeDrop($(this));
			} else {
				openDrop($(this));
			}
		});

		// ESC 키로 닫기
		$(document).on("keydown", function (e) {
			if (e.key === "Escape") {
				closeDrop($btn);
			}
		});

		// 바깥 클릭 시 닫기
		$(document).on("click", function (e) {
			if (!$(e.target).closest(".dropdown-box").length) {
				closeDrop($btn);
			}
		});
	});

	/*
	=========================================
	tab-box 처리 (접근성 포함)
	=========================================
	*/
	$(".tab-box").each(function(){
		var $tabBox = $(this);
		var $tabs = $tabBox.find(".tab");
		var group = $tabBox.data("tab-group");

		function activateTab($tab) {
			var targetId = $tab.attr("aria-controls");
			var $targetPanel = $("#" + targetId);
			var $relatedPanels = $('.tab-content-box[data-tab-group="' + group + '"]');

			// 탭 상태 업데이트
			$tabs.removeClass("active").attr("aria-selected","false").removeAttr("title");
			$tab.addClass("active").attr("aria-selected","true").attr("title","선택됨");

			// 패널 상태 업데이트
			$relatedPanels.attr("hidden",true).attr("tabindex","-1");
			$targetPanel.removeAttr("hidden").removeAttr("tabindex");
		}

		// 클릭 & 포커스 시 활성화
		$tabs.on("click focus", function(){
			activateTab($(this));
		});

		// 탭 → 해당 패널 첫 요소로 포커스
		$tabs.on("keydown", function(e){
			if(e.key === "Tab" && !e.shiftKey) {
				var targetId = $(this).attr("aria-controls");
				var $focusables = $("#" + targetId).find("a, button, input, textarea, select, [tabindex]:not([tabindex='-1'])");

				if($focusables.length){
					e.preventDefault();
					$focusables.first().focus();
				}
			}
		});

		// 패널 내부 마지막 포커스 → 다음 탭 or 다음 영역 이동
		$(".tab-content-box[data-tab-group='" + group + "']").on("keydown", function(e){
			if(e.key === "Tab" && !e.shiftKey) {
				var $focusables = $(this).find("a, button, input, textarea, select, [tabindex]:not([tabindex='-1'])");
				var lastEl = $focusables.last()[0];

				if(document.activeElement === lastEl) {
					e.preventDefault();
					var $currentTab = $tabs.filter("[aria-selected='true']");
					var currentIndex = $tabs.index($currentTab);

					if(currentIndex < $tabs.length - 1) {
						$tabs.eq(currentIndex + 1).focus();
					} else {
						// 마지막 탭이면 페이지 전체 포커스 가능한 요소로 이동
						var $allFocusables = $("a, button, input, textarea, select, [tabindex]:not([tabindex='-1'])").filter(":visible");
						var idx = $allFocusables.index($(lastEl));
						var $next = $allFocusables.eq(idx + 1);
						if($next.length) $next.focus();
					}
				}
			}
		});
	});
	
	/*
	=========================================
	tooltip-box 포커스 처리
	=========================================
	*/
	$(".tooltip-btn").on("focus", function () {
		$(this).closest(".tooltip-box").addClass("focus");
	}).on("blur", function () {
		$(this).closest(".tooltip-box").removeClass("focus");
	});
	
	/*
	=========================================
	FAQ 토글 처리
	=========================================
	*/
	$(".board-faq-box .faq-head button").on("click", function () {
        var $btn = $(this);
        var $li = $btn.closest("li");
        var $faqBody = $("#" + $btn.attr("aria-controls"));
        var isExpanded = $btn.attr("aria-expanded") === "true";

        if (isExpanded) {
            // 닫기
            $btn.attr("aria-expanded", "false");
            $faqBody.attr("hidden", true);
            $li.removeClass("active");
        } else {
            // 다른 항목 닫기
            $li.siblings().removeClass("active");
            $li.siblings().find(".faq-head button").attr("aria-expanded", "false");
            $li.siblings().find(".faq-body").attr("hidden", true);

            // 현재 항목 열기
            $btn.attr("aria-expanded", "true");
            $faqBody.removeAttr("hidden");
            $li.addClass("active");
        }
    });
	
	/*
	=========================================
	댓글영역 댓글달기, 댓글수정, 댓글취소 처리
	=========================================
	*/
	const $commentWrite = $(".comment-write"); // 원본 작성 폼
	const $commentBox = $(".board-comment-box"); // 원래 자리
	let originalTarget = null;   // 현재 이동된 위치
	let originalContent = "";    // 수정 전 원래 내용 저장
	let $clonedBodyInner = null; // 임시로 빼놓은 .cmt-body-inner
	let isUpdateMode = false;

	// 댓글 버튼 클릭 → 답글 모드
	$(document).on("click", ".cmt-reply", function () {
		resetCommentWrite();

		const $cmtBody = $(this).closest(".cmt-head").siblings(".cmt-body");
		$cmtBody.append($commentWrite);
		$commentWrite.find("textarea").val(""); // 비우기
		$commentWrite.show();

		isUpdateMode = false;
		originalTarget = $cmtBody;
	});

	// 수정 버튼 클릭 → 수정 모드
	$(document).on("click", ".cmt-update", function () {
		resetCommentWrite();

		const $cmtBody = $(this).closest(".cmt-head").siblings(".cmt-body");
		const $bodyInner = $cmtBody.find(".cmt-body-inner");

		// 원래 내용 저장 후 DOM 제거
		originalContent = $bodyInner.find("p").text();
		$clonedBodyInner = $bodyInner.detach();

		// textarea 채우기
		$commentWrite.find("textarea").val(originalContent);

		// 수정 폼 이동
		$cmtBody.append($commentWrite);
		$commentWrite.show();

		isUpdateMode = true;
		originalTarget = $cmtBody;
	});

	// 취소 버튼 클릭 → 원래 자리 복귀
	$(document).on("click", ".cmt-cancel", function () {
		if (!originalTarget) return;

		if (isUpdateMode) {
			// 제거했던 .cmt-body-inner 복구
			if ($clonedBodyInner) {
				originalTarget.prepend($clonedBodyInner);
				$clonedBodyInner = null;
			}
			isUpdateMode = false;
		}

		// textarea 초기화 및 원위치
		$commentWrite.find("textarea").val("");
		$commentBox.prepend($commentWrite);
		$commentWrite.show();

		originalTarget = null;
	});

	// 초기화 함수
	function resetCommentWrite() {
		if (originalTarget) {
			if (isUpdateMode) {
				if ($clonedBodyInner) {
					originalTarget.prepend($clonedBodyInner);
					$clonedBodyInner = null;
				}
				isUpdateMode = false;
			}
			$commentBox.prepend($commentWrite);
			$commentWrite.find("textarea").val("");
			originalTarget = null;
		}
	}
});

/*
=========================================
file-box 처리
=========================================
*/

// 파일첨부
$(document).on("change", ".file-box input[type='file']", function() {
    var file = $(this).prop("files")[0];
    var $fileBox = $(this).closest(".file-box");
    var $fileText = $fileBox.find(".file-name p");

    if (file) {
        $fileText.text(file.name);
        $fileBox.find(".file-name").addClass("success");
    } else {
        $fileText.text("선택된 파일 없음");
        $fileBox.find(".file-name").removeClass("success");
    }
});

// 파일첨부 영역 추가
$(document).on("click", ".file-add", function () {
    const $fileBox = $(this).closest(".file-box");
    const $fileInput = $fileBox.find("input[type='file']");

    // 파일 첨부 여부 확인
    if (!$fileInput[0].files.length) {
        alert("파일을 첨부한 후에 추가할 수 있습니다.");
        return; // 복제 중단
    }

    const $clone = $fileBox.clone();

    // 첨부내용 초기화
    $clone.find("input[type='file']").val(""); // 파일 초기화
    $clone.find(".file-name p").text("선택된 파일 없음"); // 파일명 초기화
    $clone.find(".file-name").removeClass("success"); // success 클래스 제거

    // 같은 그룹 안에서 복제
    $fileBox.after($clone);
});

// 파일첨부 영역 삭제
$(document).on("click", ".file-remove", function () {
    const $fileBox = $(this).closest(".file-box"); 
    const $group = $fileBox.closest(".file-group-box"); // 가장 상위 부모 요소

    // 해당 그룹 내부의 file-box 개수 확인
    if ($group.find(".file-box").length > 1) {
        $fileBox.remove();
    } else {
        alert("최소 1개의 파일 첨부 영역은 남겨야 합니다.");
    }
});

/*
=========================================
star-box 별점 처리
=========================================
*/
$(document).on("change", ".star-box input", function() {
    var $currentStar = $(this).closest(".star");
    var $starBox = $currentStar.closest(".star-box");

    $starBox.find(".star").removeClass("active");
    $currentStar.prevAll(".star").addBack().addClass("active");
});

/*
=========================================
table-box 정렬(오름,내림차순)방식 처리
=========================================
*/
$(document).on("click", ".icon-sort", function () {
    var $btn = $(this);
    var $th = $btn.closest("th");
    var $table = $th.closest("table");
    var $tbody = $table.find("tbody");

    // 헤더에 심어둔 data-col-index 가져오기
    var colIndex = parseInt($th.data("col-index"), 10);

    // 현재 버튼 상태 class 확인
    var state;
    if ($btn.hasClass("is-asc")) {
        state = "ascending";
    } else if ($btn.hasClass("is-desc")) {
        state = "descending";
    } else {
        state = "none";
    }

    // th의 실제 텍스트 추출 (버튼 제외)
    var colName = $.trim(
        $th.clone().children("button").remove().end().text()
    );

    // 다른 버튼 초기화
    $table.find(".icon-sort").removeClass("is-asc is-desc")
        .each(function () {
            var $otherBtn = $(this);
            var $otherTh = $otherBtn.closest("th");
            var otherColName = $.trim(
                $otherTh.clone().children("button").remove().end().text()
            );
            $otherTh.attr("aria-sort", "none");
            $otherBtn.attr("aria-label", otherColName + " 오름차순으로 정렬");
        });

    // 다음 상태 결정 및 적용 (오름차순 ↔ 내림차순만)
    var next;
    if (state === "ascending") {
        next = "descending";
        $btn.removeClass("is-asc").addClass("is-desc");
        $th.attr("aria-sort", "descending");
        $btn.attr("aria-label", colName + " 오름차순으로 정렬");
    } else {
        next = "ascending";
        $btn.removeClass("is-desc").addClass("is-asc");
        $th.attr("aria-sort", "ascending");
        $btn.attr("aria-label", colName + " 내림차순으로 정렬");
    }

    // tbody 정렬
    var rows = $tbody.find("tr").get();
    rows.sort(function (a, b) {
        var A = $(a).children("td").eq(colIndex).text().trim();
        var B = $(b).children("td").eq(colIndex).text().trim();

        // 숫자/퍼센트/콤마 처리
        var numA = A.replace(/[^0-9.-]/g, "");
        var numB = B.replace(/[^0-9.-]/g, "");
        if (numA !== "" && numB !== "") {
            A = parseFloat(numA);
            B = parseFloat(numB);
        }

        if (A < B) return next === "ascending" ? -1 : 1;
        if (A > B) return next === "ascending" ? 1 : -1;
        return 0;
    });

    $.each(rows, function (i, row) {
        $tbody.append(row); // DOM에 다시 삽입
    });
});

/*
=========================================
활성화 함수
=========================================
*/

// 본인 활성화
function activeThis(btn){
	$(btn).toggleClass("active");
}

// 부모요소 활성화
function activeParent(btn, tar){
	var $parent = $(btn).closest("." + tar);
	
	$parent.toggleClass("active");
}

/*
=========================================
포커스 트랩 (모바일 메뉴/모달)
=========================================
*/
let lastFocusedElement = null;
let focusTrapHandler = null;

function trapFocus($container) {
	const $focusable = $container.find(
		'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
	);

	if ($focusable.length === 0) {
		$container.attr("tabindex", "0").focus();
		return;
	}

	const $first = $focusable.first();
	const $last = $focusable.last();

	focusTrapHandler = function (e) {
		if (e.key !== "Tab") return;
		if (e.shiftKey && $(document.activeElement).is($first)) {
			e.preventDefault(); $last.focus();
		} else if (!e.shiftKey && $(document.activeElement).is($last)) {
			e.preventDefault(); $first.focus();
		}
	};

	$container.on("keydown", focusTrapHandler);
	setTimeout(() => $first.focus(), 10);
}

/*
=========================================
모바일 메뉴 열기/닫기
=========================================
*/
function menuOpen(e) {
	$("html, body, header").addClass("fixed");
	const $mobileMenu = $(".header-mobile");
	if (!$mobileMenu.length) return;
	lastFocusedElement = e?.currentTarget || document.activeElement;
	$mobileMenu.css("display", "flex");
	trapFocus($mobileMenu);
}

function menuClose() {
	const $mobileMenu = $(".header-mobile");
	if (!$mobileMenu.length) return;
	$("html, body, header").removeClass("fixed");

	if (focusTrapHandler) {
		$mobileMenu.off("keydown", focusTrapHandler);
		focusTrapHandler = null;
	}

	if (lastFocusedElement && $.contains(document.body, lastFocusedElement)) {
		setTimeout(() => { try { lastFocusedElement.focus(); } catch(e){} }, 10);
	}
	lastFocusedElement = null;
}

/*
=========================================
모달 열기/닫기
=========================================
*/
function modalOpen(e, btn) {
    const $box = $("#" + $(btn).attr("aria-controls"));
    if (!$box.length) return;

    lastFocusedElement = btn;
    $("html, body").addClass("fixed");

    $box
        .removeAttr("inert") // inert 제거 → 포커스 가능
        .attr("aria-hidden", "false")
        .addClass("fixed");

    trapFocus($box); // 포커스 트랩
}

function modalClose(el) {
    const $box = $(el).closest(".modal-box");
    $("html, body").removeClass("fixed");

    $box
        .attr("inert", "") // inert 추가 → 포커스 불가
        .attr("aria-hidden", "true")
        .removeClass("fixed");

    if (lastFocusedElement) {
        $(lastFocusedElement).focus();
    }
}

/*
=========================================
토스트 열기/닫기
=========================================
*/
let toastTimer = null;
let progressTimer = null;

function toastOpen(btn) {
    const $btn = $(btn);
    const $toast = $("#" + $btn.attr("aria-controls"));
    if (!$toast.length) return;

    // 마지막 포커스 요소 저장
    lastFocusedElement = btn;

    // 기존 토스트 닫기 & 타이머 초기화
    $(".toast-box")
        .removeClass("fixed")
        .attr("aria-hidden", "true")
        .attr("inert", "");
    $(".button-box .btn").attr("aria-expanded", "false");

    if (toastTimer) clearTimeout(toastTimer);
    if (progressTimer) clearInterval(progressTimer);

    // 현재 토스트 열기
    $toast
        .addClass("fixed")
        .attr("aria-hidden", "false")
        .removeAttr("inert");
    $btn.attr("aria-expanded", "true");

    // 진행바 초기화
    const $progress = $toast.find(".toast-progress");
    $progress.css("width", "0%");

    // 포커스트랩 적용 (toast 내부로 포커스 이동)
    trapFocus($toast);

    // 진행 시간 (ms)
    const duration = 3000;
    const interval = 30;
    let elapsed = 0;

    progressTimer = setInterval(function () {
        elapsed += interval;
        const percent = Math.min(100, (elapsed / duration) * 100);
        $progress.css("width", percent + "%")
                 .attr("aria-valuenow", Math.round(percent));
        if (elapsed >= duration) {
            clearInterval(progressTimer);
        }
    }, interval);

    // 자동 닫기
    toastTimer = setTimeout(function () {
        toastClose($toast, { restoreFocus: true }); // 자동닫힘 시 버튼으로 복귀
        $btn.attr("aria-expanded", "false");
    }, duration);
}

function toastClose(el, options = { restoreFocus: true }) {
    const $toast = $(el).closest(".toast-box");
    $toast
        .removeClass("fixed")
        .attr("aria-hidden", "true")
        .attr("inert", "");

    // 진행바 리셋
    const $progress = $toast.find(".toast-progress");
    $progress.css("width", "0");

    // 버튼 상태 닫힘으로
    const targetId = $toast.attr("id");
    $("[aria-controls='" + targetId + "']").attr("aria-expanded", "false");

    // 타이머 정리
    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }

    // 이벤트 해제 (포커스트랩 해제)
    $toast.off("keydown", focusTrapHandler);

    // 원래 열었던 버튼으로 포커스 복귀 (자동닫힘/수동닫힘 공통)
    if (options.restoreFocus && lastFocusedElement) {
        $(lastFocusedElement).focus();
        lastFocusedElement = null; // 초기화
    }
}

/*
=========================================
ESC & 모달, 메뉴바 토스트 바깥 클릭 닫기
=========================================
*/
$(document).on("keydown", function (e) {
    if (e.key === "Escape" || e.keyCode === 27) {
        const $modal = $(".modal-box.fixed");
        const $menu = $(".header-mobile").filter(":visible");
        const $toast = $(".toast-box.fixed");

        if ($modal.length) {
            const $closeBtn = $modal.find(".close, .btn_close_popup");
            $closeBtn.length ? $closeBtn.trigger("click") : modalClose($modal);
        } else if ($menu.length) {
            menuClose();
        } else if ($toast.length) {
            const $closeBtn = $toast.find(".close");
            $closeBtn.length ? $closeBtn.trigger("click") : toastClose($toast);
        }
    }
});

$(document).on("mouseup", function (e) {
	// modal 본인 클릭 시 닫기 (내부 자식 클릭은 제외)
	$(".modal-box.fixed").each(function () {
		if (e.target === this) {
			const $closeBtn = $(this).find(".close, .btn_close_popup");
			$closeBtn.length ? $closeBtn.trigger("click") : modalClose($(this));
		}
	});
	const $mobileMenu = $(".right-menu");
	// 클릭한 요소가 .right-menu 내부에 없다면 닫기
    if (!$mobileMenu.is(e.target) && $mobileMenu.has(e.target).length === 0) {
        $mobileMenu.removeClass("active");
    }
});

// 이모션 체크
$(document).on("change", ".face-check-box.emotion input", function(){
	var imgSrc = $(this).attr("data-img");
	var imgTar = $(".emotion-result-box .result img");
	
	imgTar.attr("src", imgSrc);
});

$(document).ready(function() {
    // 파일 선택 시 처리
    $(".file-image-box input[type='file']").on("change", function(e) {
        let fileInput = $(this);
        let file = this.files[0];

        if (file) {
            let fileName = file.name.toLowerCase();
            // 이미지 확장자 체크
            if (!(/\.(jpg|jpeg|png|gif)$/i).test(fileName)) {
                alert("이미지 파일만 첨부할 수 있습니다.");
                fileInput.val(""); // 초기화
                return;
            }

            let reader = new FileReader();
            reader.onload = function(e) {
                let label = fileInput.next("label");

                // 기존 이미지, 버튼 제거 후 다시 추가
                label.find("img, .delete").remove();

                // 이미지와 삭제 버튼 추가
                label.append('<img src="' + e.target.result + '" alt="첨부 이미지">');
                label.append('<button type="button" class="delete">삭제</button>');
            };
            reader.readAsDataURL(file);
        }
    });

    // 삭제 버튼 클릭 시 처리
    $(document).on("click", ".file-image-box .delete", function(e) {
        e.preventDefault();      // 기본 동작 막기
        e.stopPropagation();     // label 클릭 이벤트 막기

        let label = $(this).closest("label");
        let input = label.prev("input[type='file']");

        // 이미지와 버튼 제거 (li는 그대로 둠)
        label.find("img, .delete").remove();

        // input 값 초기화
        input.val("");
    });
	
    // input 값 변경 시 active 클래스 토글
    $(".map-search input").on("input", function() {
        let inputVal = $(this).val().trim();
        let wrapper = $(this).closest(".map-search");

        if (inputVal.length > 0) {
            wrapper.addClass("active");
        } else {
            wrapper.removeClass("active");
        }
	});
    // delete 버튼 클릭 시 input 초기화 + active 제거
    $(".map-search .delete").on("click", function(e) {
        e.preventDefault();

        let wrapper = $(this).closest(".map-search");
        let input = wrapper.find("input");

        input.val("");              // 값 지움
        wrapper.removeClass("active"); // active 제거
        input.focus();              // 다시 입력할 수 있게 포커스 줌 (선택사항)
    });
});






