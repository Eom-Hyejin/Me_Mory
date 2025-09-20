let mainRecentSwiper = null;

function initMainRecentSwiper() {
    // 이미 Swiper가 있으면 제거
    if (mainRecentSwiper) {
        mainRecentSwiper.destroy(true, true);
        mainRecentSwiper = null;
    }

    let slidesPerViewValue;
    let gridOption = null;
    let loopOption = true;

    // 기본 옵션
    const swiperOptions = {
        spaceBetween: window.innerWidth <= 991 ? 12 : 40,
        centeredSlides: window.innerWidth > 991,
        autoplay: {
            delay: 2500,
            disableOnInteraction: false,
        },
    };

    if (window.innerWidth <= 991) {
        // 모바일 (2x2 그리드 + 페이지네이션)
        slidesPerViewValue = 2;
        gridOption = { rows: 2, fill: "row" };
        loopOption = false; // grid 모드에서는 loop 비권장

        swiperOptions.pagination = {
            el: ".main-recent-box .swiper-pagination",
            clickable: true,
        };
    } else if (window.innerWidth > 1500) {
        slidesPerViewValue = 5.5;
        loopOption = true;
    } else if (window.innerWidth >= 1200) {
        slidesPerViewValue = 4.5;
        loopOption = true;
    } else {
        slidesPerViewValue = 3.5;
        loopOption = true;
    }

    swiperOptions.slidesPerView = slidesPerViewValue;
    swiperOptions.grid = gridOption;
    swiperOptions.loop = loopOption;

    // Swiper 생성
    mainRecentSwiper = new Swiper(".main-recent-box .swiper-container", swiperOptions);

    // autoplay 강제 실행
    if (mainRecentSwiper.autoplay) {
        mainRecentSwiper.autoplay.start();
    }
}

// DOM 준비 후 실행
document.addEventListener("DOMContentLoaded", () => {
    initMainRecentSwiper();
    window.addEventListener("resize", initMainRecentSwiper);
});

const cateSwiper = new Swiper(".main-category-box .swiper-container", {
    slidesPerView: 3,     // 기본 보여지는 개수
    spaceBetween: 12,     // 기본 간격(px)
    navigation: {         // 화살표 버튼
        nextEl: ".main-category-box .swiper-button-next",
        prevEl: ".main-category-box .swiper-button-prev",
    },
    loop: true,
    breakpoints: {
		// 991px 이하일 때 적용
        991: {
            spaceBetween: 12
        },
        // 991px 이하일 때 적용
        0: {
            spaceBetween: 8
        }
    }
});

const dateSwiper = new Swiper(".main-date-box .date-swiper .swiper-container", {
    slidesPerView: 2.2,           // 기본값 (991~1199px)
    spaceBetween: 30,             // 기본 간격
    centeredSlides: true,         // 가운데 정렬
    loop: true,
    breakpoints: {
        0: {                      // 0 ~ 990px
            slidesPerView: 1.5,
            spaceBetween: 10
        },
        991: {                    // 991 ~ 1199px
            slidesPerView: 2.2,
            spaceBetween: 30
        },
        1200: {                   // 1200px 이상
            slidesPerView: 3,
            spaceBetween: 70
        }
    }
});


