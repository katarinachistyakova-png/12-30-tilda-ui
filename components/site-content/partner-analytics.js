/*
  12:30 · Аналитика партнёров (partner-analytics)

  Маленький помощник: считает показы и клики блоков блогеров и стилистов
  в существующей Яндекс.Метрике сайта. Никакого своего счётчика, базы или сервера.

  Три цели в Метрике на всех партнёров и все места:
    partner_impression      — человека реально увидели;
    partner_click           — нажали на блок человека (фото, имя, каталог, вещь, Telegram);
    collaboration_cta_click — нажали «Хочу сотрудничать» (это намерение стать партнёром,
                              не взаимодействие с конкретным человеком).
  Всё остальное (кто, где, на что нажали) идёт параметрами, поэтому новый
  партнёр или новое место не требуют ни нового JS, ни новых целей.

  Параметры partner_*: person_id, person_name, placement, action, target, source,
  product_uid и product_title — только если нажали на вещь.
  Параметры collaboration_cta_click: placement, source (hero / final / …), target: application.
  Только поведение, никаких персональных данных посетителя.

  Разметка (одинаковая для любого места; стили она не затрагивает):
    data-s1230-person="id"        на карточке человека (id — из content.js);
    data-s1230-name="Имя"         на ней же;
    data-s1230-target / -source   на ссылке: catalog|product|telegram и photo|name|all_items|preview|telegram;
    data-s1230-product="uid"      на ссылке-вещи (название берётся из её aria-label);
    data-s1230-cta="hero"         на кнопке «Хочу сотрудничать» (значение — где кнопка стоит).
  Подключение к странице: s1230PartnerAnalytics.attach(контейнер, 'placement').

  Счётчик ищется среди уже подключённых на странице (Tilda подключает Метрику сама).
  Если в настройках нужно указать его явно — window.s1230Content.analytics.counterId.
  Метрики нет или она не загрузилась — ничего не происходит, ссылки работают как обычно.

  Подключение: тем же блоком T123, что и content.js, после него.
  Локально: <script src="../site-content/partner-analytics.js"></script>.
  Описание — site-content/README.md, раздел PARTNER ANALYTICS.
*/
(function () {
  var GOAL_IMPRESSION = 'partner_impression';
  var GOAL_CLICK = 'partner_click';
  var GOAL_CTA = 'collaboration_cta_click';
  var SEEN_RATIO = 0.5;      // какая часть блока должна быть видна
  var SEEN_MS = 1000;        // и как долго

  var sent = {};             // один показ человека в одном месте за загрузку страницы

  function counterId() {
    try {
      var cfg = window.s1230Content && window.s1230Content.analytics;
      if (cfg && cfg.counterId) return cfg.counterId;
      // Современный тег Метрики
      var ya = window.Ya && window.Ya._metrika;
      if (ya && ya.getCounters) {
        var list = ya.getCounters();
        if (list && list.length) return list[0].id;
      }
      // Старый тег (его до сих пор вставляет Tilda): window.yaCounterNNNNNNNN
      for (var key in window) {
        var m = /^yaCounter(\d+)$/.exec(key);
        if (m) return Number(m[1]);
      }
    } catch (e) {}
    return null;
  }

  function send(goal, params) {
    try {
      var id = counterId();
      if (id && typeof window.ym === 'function') window.ym(id, 'reachGoal', goal, params);
    } catch (e) {
      // Аналитика никогда не мешает странице
    }
  }

  function params(action, person, placement, target, source, product) {
    var p = {
      person_id: person.id,
      person_name: person.name,
      placement: placement,
      action: action
    };
    if (target) p.target = target;
    if (source) p.source = source;
    if (product && product.productUid) {
      p.product_uid = String(product.productUid);
      if (product.title) p.product_title = product.title;
    }
    return p;
  }

  // trackPartnerEvent('click', person, 'homepage_bloggers', 'product', 'preview', product)
  function trackPartnerEvent(action, person, placement, target, source, product) {
    if (!person || !person.id) return;
    if (action === 'impression') {
      var k = placement + '/' + person.id;
      if (sent[k]) return;
      sent[k] = true;
      send(GOAL_IMPRESSION, params(action, person, placement));
    } else {
      send(GOAL_CLICK, params(action, person, placement, target, source, product));
    }
  }

  // Намерение сотрудничать: где стоит кнопка — в source
  function trackCollaborationCta(placement, source) {
    send(GOAL_CTA, { placement: placement, source: source, target: 'application' });
  }

  function personOf(card) {
    var id = card && card.getAttribute('data-s1230-person');
    return id ? { id: id, name: card.getAttribute('data-s1230-name') || id } : null;
  }

  // Показ: блок виден на 50% хотя бы секунду. Вернёт функцию, снимающую наблюдение.
  function watchImpression(element, person, placement) {
    if (!element || !person || !('IntersectionObserver' in window)) return function () {};
    var timer = 0;
    var observer = new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      // Блок выше экрана (узкий телефон): достаточно, чтобы половина экрана была им занята
      var tall = e.rootBounds && e.intersectionRect.height >= e.rootBounds.height * SEEN_RATIO;
      var seen = e.isIntersecting && (e.intersectionRatio >= SEEN_RATIO || tall);
      clearTimeout(timer);
      if (!seen) return;
      timer = setTimeout(function () {
        trackPartnerEvent('impression', person, placement);
        observer.disconnect();
      }, SEEN_MS);
    }, { threshold: [0, 0.25, SEEN_RATIO, 0.75, 1] });
    observer.observe(element);
    return function () { clearTimeout(timer); observer.disconnect(); };
  }

  // Показы всех карточек [data-s1230-person] внутри контейнера. Вызывать после отрисовки.
  function observe(container, placement) {
    var stops = [];
    var cards = container.querySelectorAll('[data-s1230-person]');
    for (var i = 0; i < cards.length; i++) {
      stops.push(watchImpression(cards[i], personOf(cards[i]), placement));
    }
    return function () { stops.forEach(function (stop) { stop(); }); };
  }

  // Клики: один обработчик на контейнер, что нажато — из data-атрибутов ссылки.
  function attach(container, placement) {
    if (!container || container.getAttribute('data-s1230-pa-attached')) return;
    container.setAttribute('data-s1230-pa-attached', '1');

    function onClick(e) {
      try {
        var link = e.target.closest && e.target.closest('[data-s1230-target], [data-s1230-cta]');
        if (!link || !container.contains(link)) return;
        var cta = link.getAttribute('data-s1230-cta');
        if (cta) return trackCollaborationCta(placement, cta);

        var person = personOf(link.closest('[data-s1230-person]'));
        var uid = link.getAttribute('data-s1230-product');
        trackPartnerEvent('click', person, placement,
          link.getAttribute('data-s1230-target'), link.getAttribute('data-s1230-source'),
          uid ? { productUid: uid, title: link.getAttribute('aria-label') } : null);
      } catch (err) {
        // Аналитика никогда не мешает ссылке
      }
    }

    container.addEventListener('click', onClick);
    container.addEventListener('auxclick', function (e) { if (e.button === 1) onClick(e); });
  }

  window.s1230PartnerAnalytics = {
    attach: attach,
    observe: observe,
    track: trackPartnerEvent,
    trackCollaborationCta: trackCollaborationCta
  };
})();
