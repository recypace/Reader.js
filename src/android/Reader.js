import _Reader from '../common/_Reader';
import Content from './Content';
import Util from '../common/Util';

const RETRY_REQUIRED = -1;

/**
 * @class Reader
 * @extends _Reader
 * @property {boolean} calcPageForDoublePageMode
 */
export default class Reader extends _Reader {
  /**
   * @param {Context} context
   */
  constructor(context) {
    super(context);
    this.calcPageForDoublePageMode = false;
  }

  /**
   * @typedef {object} ContentRef
   * @property {HTMLElement} element
   * @property {string} src
   */
  /**
   * @param {ContentRef} ref
   * @returns {Content}
   * @private
   */
  _createContent(ref) {
    return new Content(ref.element, ref.src, this);
  }

  /**
   * @param {number} currentTime
   * @param {number} start
   * @param {number} change
   * @param {number} duration
   * @returns {number}
   * @private
   */
  _easeInOut(currentTime, start, change, duration) {
    let time = currentTime;
    time /= duration / 2;
    if (time < 1) {
      return (((change / 2) * time) * time) + start;
    }
    time -= 1;
    return ((-change / 2) * ((time * (time - 2)) - 1)) + start;
  }

  /**
   * @param {number} offset
   * @param {boolean} animated
   */
  scrollTo(offset = 0, animated = false) {
    // offset이 maxOffset을 넘길 수 없도록 보정한다. 이게 필요한 이유는 아래와 같다.
    // - 스크롤 보기에서 잘못해서 paddingBottom 영역으로 이동해 다음 스파인으로 이동되는 것을 방지
    // - 보기 설정 미리보기를 보여주는 중에 마지막 페이지보다 뒤로 이동해 빈 페이지가 보이는 것을 방지
    // 네이티브에서 보정하지 않는 것은 WebView.getContentHeight 값을 신뢰할 수 없기 때문이다.
    let adjustOffset = offset;
    if (this.context.isScrollMode) {
      const height = this.context.pageHeightUnit;
      const paddingTop = Util.getStylePropertyIntValue(this._wrapper, 'padding-top');
      const paddingBottom = Util.getStylePropertyIntValue(this._wrapper, 'padding-bottom');
      const maxOffset = this.totalHeight - height - paddingBottom;
      const diff = maxOffset - adjustOffset;
      if (adjustOffset > paddingTop && diff < height && diff > 0) {
        adjustOffset = maxOffset;
      }
      adjustOffset = Math.min(adjustOffset, maxOffset);
    } else {
      const width = this.context.pageWidthUnit;
      const maxPage = Math.max(this.calcPageCount() - this._calcExtraPageCount(), 0);
      adjustOffset = Math.min(adjustOffset, maxPage * width);
    }

    if (animated) {
      if (this._scrollTimer) {
        clearTimeout(this._scrollTimer);
        this._scrollTimer = null;
      }

      const start = this.context.isScrollMode ? this.pageYOffset : this.pageXOffset;
      const change = adjustOffset - start;
      const increment = 20;
      const duration = 200;
      const animateScroll = (elapsedTime) => {
        const time = elapsedTime + increment;
        super.scrollTo(this._easeInOut(time, start, change, duration));
        if (time < duration) {
          this._scrollTimer = setTimeout(() => {
            animateScroll(time);
          }, increment);
        } else {
          this._scrollTimer = null;
        }
      };

      animateScroll(0);
    } else {
      super.scrollTo(adjustOffset);
    }
  }

  /**
   * @returns {number}
   * @private
   */
  _calcExtraPageCount() {
    const height = this.context.pageHeightUnit;
    const marginBottom = Util.getStylePropertyIntValue(this._wrapper, 'margin-bottom');
    return marginBottom / (this.context.isDoublePageMode ? height * 2 : height);
  }

  /**
   * @returns {number}
   */
  calcPageCount() {
    if (document.fonts) {
      // https://drafts.csswg.org/css-font-loading/#dom-fontfaceloadstatus-loading
      // 사용된 적이 없는 Font : unloaded
      // 로딩중인 Font : loading
      // 로딩된 Font : loaded
      // 로딩 실패한 Font : error
      // document.fonts.status, ready는 신뢰할 수 없으므로 아래와 같은 방법으로 체크
      const fontFaceLoadingStatusList = [];
      document.fonts.forEach(fontFace => fontFaceLoadingStatusList.push(fontFace.status));
      if (fontFaceLoadingStatusList.indexOf('loading') >= 0) {
        return RETRY_REQUIRED;
      }
    }

    if (this.context.isScrollMode) {
      return Math.round(this.totalHeight / this.context.pageHeightUnit);
    }

    const columnWidth = this.context.pageWidthUnit - this.context.pageGap;
    if (this.totalWidth < columnWidth) {
      // 가끔 total width가 0으로 넘어오는 경우가 있다. (커버 페이지에서 이미지가 그려지기 전에 호출된다거나)
      // 젤리빈에서는 0이 아닌 getWidth()보다 작은 값이 나오는 경우가 확인되었으며 재요청시 정상값 들어옴.
      return RETRY_REQUIRED;
    }

    return Math.ceil(this.totalWidth / this.context.pageWidthUnit);
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {number} gap
   * @param {string} style
   */
  changePageSizeWithStyle(width, height, gap, style) {
    let prevPage = this.curPage;

    this.context = Object.assign(this.context, { width, height, gap });

    const elements = document.getElementsByTagName('STYLE');
    const element = elements[elements.length - 1];
    element.innerHTML = style;

    setTimeout(() => {
      const maxPage = this.calcPageCount();
      if (maxPage !== RETRY_REQUIRED) {
        prevPage = Math.min(prevPage, Math.max(maxPage - 1 - this._calcExtraPageCount(), 0));
      }
      this.scrollTo(prevPage * this.context.pageUnit);
    }, 0);
  }

  /**
   * @param {*} args
   * @private
   */
  _moveTo(...args) {
    const method = args[0];
    if (this.context.isScrollMode) {
      const scrollY = this[`getOffsetFrom${method}`](args[1]);
      if (scrollY !== null) {
        android[`onScrollYOffsetOf${method}Found`](android.dipToPixel(scrollY));
        return;
      }
    } else {
      const page = this[`getOffsetFrom${method}`](args[1]);
      if (page !== null) {
        android[`onPageOffsetOf${method}Found`](page);
        return;
      }
    }
    android[`on${method}NotFound`]();
  }

  /**
   * @param {string} anchor
   */
  moveToAnchor(anchor) {
    this._moveTo('Anchor', anchor);
  }

  /**
   * @param {string} serializedRange
   */
  moveToSerializedRange(serializedRange) {
    this._moveTo('SerializedRange', serializedRange);
  }

  /**
   * @param {string} location
   */
  moveToNodeLocation(location) {
    this._moveTo('NodeLocation', location);
  }
}
