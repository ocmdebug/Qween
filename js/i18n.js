/* =============================================================================
 * i18n.js — every user-facing string the JavaScript produces at runtime.
 *
 * The interface is Polish. Three places hold Polish text, and only three:
 *   1. index.html      — static markup (headings, buttons, dialog copy)
 *   2. js/config.js    — FIELD_DEFS `label` and `group`
 *   3. this file       — anything built at runtime (counts, errors, status)
 *
 * Everything else stays English on purpose: JSON keys, code, comments, docs,
 * the extraction prompt and `schemaDesc` (those are instructions to the model,
 * not interface).
 *
 * Polish plurals need three forms, so strings with a count go through plural().
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  /**
   * Polish plural selector.
   *   1            -> one    (1 plik)
   *   2-4          -> few    (2 pliki)   but not 12-14
   *   everything   -> many   (5 plików)
   */
  function plural(n, one, few, many) {
    var abs = Math.abs(n);
    if (abs === 1) return one;
    var mod10 = abs % 10;
    var mod100 = abs % 100;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
    return many;
  }

  function files(n) { return plural(n, 'plik', 'pliki', 'plików'); }
  function pagesNom(n) { return plural(n, 'strona', 'strony', 'stron'); }
  function pagesAcc(n) { return plural(n, 'stronę', 'strony', 'stron'); }
  function tries(n) { return plural(n, 'próba', 'próby', 'prób'); }
  function keysWord(n) { return plural(n, 'pole', 'pola', 'pól'); }

  App.T = {
    plural: plural,

    /* ---------------------------------------------------------- screen 1 */
    noFile: 'Nie wybrano pliku.',
    filesSummary: function (n) {
      return n + ' ' + files(n) + ' — traktowane jako strony jednego dokumentu, w tej kolejności.';
    },
    ignoredFormats: function (names) {
      return 'Pominięto (nieobsługiwany format): ' + names.join(', ');
    },
    pagesPrepared: function (n, size) {
      return 'Przygotowano ' + n + ' ' + pagesAcc(n) + ' — rozmiar żądania ' + size;
    },
    loadingPages: function (n, size) {
      return n + ' ' + pagesNom(n) + ' · ' + size;
    },
    cancelled: 'Odczyt anulowany.',
    remove: 'Usuń',

    /* ---------------------------------------------------------- screen 2 */
    copied: 'Skopiowano',
    rawEmpty: '(pusto)',
    pageCaption: function (sourceName, pageNumber, w, h, size) {
      return sourceName +
        (pageNumber > 1 ? ' · strona ' + pageNumber : '') +
        ' · ' + w + '×' + h + ' px · ' + size;
    },
    metaPages: function (n) { return n + ' ' + pagesNom(n); },
    metaTokens: function (n) { return n + ' tokenów'; },
    metaAttempts: function (n) { return n + ' ' + tries(n); },
    metaPreprocessed: 'po wstępnej obróbce',

    noteMissingKeys: function (n, list, empty) {
      return 'Model pominął ' + n + ' ' + keysWord(n) + ': ' + list.join(', ') +
             '. Uzupełniono wartością „' + empty + '".';
    },
    noteUnexpectedKeys: function (list) {
      return 'Model zwrócił nieoczekiwane pola, zignorowano: ' + list.join(', ') + '.';
    },
    noteFinishReason: function (reason) {
      return 'Model zakończył odpowiedź przedwcześnie (finish_reason: ' + reason + ').';
    },

    downloadPrefix: 'transkrypcja',
    downloadExtraPrefix: 'dane-dodatkowe',

    /* --------------------------------------------------------- settings */
    keyNone: 'Brak zapisanego klucza. Bez niego aplikacja nie wywoła modelu.',
    keyStored: function (masked) { return 'Klucz zapisany w tej przeglądarce: ' + masked; },
    keyEnterFirst: 'Najpierw wpisz klucz.',
    keyLooksWrong: 'To nie wygląda na klucz OpenRouter (zaczynają się od „sk-or-"). Zapisano mimo to.',

    /* ------------------------------------------------------------ images */
    imgSkippedLimit: function (name, max) {
      return 'Pominięto „' + name + '" — osiągnięto limit ' + max + ' ' + pagesNom(max) + '.';
    },
    imgPdfTruncated: function (name, total, loaded) {
      return 'Plik „' + name + '" ma ' + total + ' ' + pagesNom(total) +
             '; wczytano tylko pierwsze ' + loaded + ' ' + pagesAcc(loaded) + '.';
    },
    imgNoPdfLib: 'Biblioteka pdf.js nie została wczytana. Obsługa PDF wymaga połączenia z internetem.',
    imgCannotRead: function (name) { return 'Nie udało się odczytać pliku „' + name + '".'; },
    imgCannotDecode: function (name) { return 'Nie udało się zdekodować pliku „' + name + '" jako obrazu.'; },
    imgNoPages: 'Z wybranych plików nie udało się przygotować żadnej strony.',

    /* ------------------------------------------------------------ errors */
    errNoKey: 'Nie ustawiono klucza API OpenRouter. Otwórz Ustawienia i dodaj klucz.',
    errNoPages: 'Brak stron do wysłania.',
    errBadRequest: 'OpenRouter odrzucił żądanie (400). Zwykle oznacza to, że wybrany model nie obsługuje którejś z opcji żądania.',
    errUnauthorized: 'Klucz API odrzucony (401). Otwórz Ustawienia i wpisz klucz OpenRouter ponownie.',
    errNoCredits: 'Brak środków (402). Doładuj konto OpenRouter albo wybierz tańszy model.',
    errForbidden: 'Brak dostępu (403). Ten klucz może nie mieć uprawnień do wybranego modelu.',
    errNotFound: 'Nie znaleziono modelu (404). Identyfikator w config.js może być błędny lub model został wycofany.',
    errTooLarge: 'Żądanie za duże (413). Zmniejsz liczbę stron albo limit rozmiaru obrazu.',
    errRateLimited: 'Przekroczono limit zapytań (429). Odczekaj chwilę i naciśnij „Odczytaj ponownie".',
    errProvider: function (status) {
      return 'Dostawca modelu zwrócił błąd (' + status + '). Spróbuj ponownie albo wybierz inny model.';
    },
    errProviderPlain: 'Dostawca modelu zgłosił błąd.',
    errHttp: function (status) { return 'Żądanie nie powiodło się, HTTP ' + status + '.'; },
    errTimeout: function (seconds) {
      return 'Przekroczono czas oczekiwania (' + seconds + ' s). Model może być przeciążony — spróbuj ponownie lub wybierz mniejszy model.';
    },
    errNetwork: 'Nie udało się połączyć z OpenRouter. Sprawdź połączenie z internetem.',
    errEmptyResponse: 'Model zwrócił pustą odpowiedź.',
    errMalformedJson: 'Model nie zwrócił poprawnego JSON-a. Pełny tekst znajdziesz w panelu „Surowa odpowiedź".',
    errMalformedEnvelope: 'OpenRouter zwrócił odpowiedź, która nie jest JSON-em.',
    errNotObject: 'Model zwrócił JSON, który nie jest obiektem.',

    /* ======================================================== iteration 2 */

    /* --- walidacja ----------------------------------------------------- */
    vMale: 'mężczyzna',
    vFemale: 'kobieta',
    vPeselDigitsOnly: 'PESEL może zawierać tylko cyfry.',
    vPeselLength: function (n) { return 'PESEL ma 11 cyfr, a tu jest ' + n + '.'; },
    vPeselBadDate: 'Cyfry 1–6 nie tworzą poprawnej daty urodzenia.',
    vPeselChecksum: 'Ten numer nie przechodzi sumy kontrolnej PESEL.',
    vPeselOk: function (dob, sex) { return 'Suma kontrolna poprawna · ur. ' + dob + ' · ' + sex; },
    vNipLetter: function (c) { return 'NIP zawiera literę „' + c + '".'; },
    vNipLength: function (n) { return 'NIP ma 10 cyfr, a tu jest ' + n + '.'; },
    vNipChecksum: 'Ten numer nie przechodzi sumy kontrolnej NIP.',
    vNipOk: 'Suma kontrolna NIP poprawna.',
    vRegonDigits: 'REGON może zawierać tylko cyfry.',
    vRegonLength: function (n) { return 'REGON ma 9 albo 14 cyfr, a tu jest ' + n + '.'; },
    vRegonChecksum: 'Ten numer nie przechodzi sumy kontrolnej REGON.',
    vRegonOk: 'Suma kontrolna REGON poprawna.',
    vZipFormat: 'Kod pocztowy ma format 00-000.',
    vZipOk: 'Format kodu poprawny.',
    vDateFormat: 'Data w formacie RRRR-MM-DD.',
    vDateFuture: 'Data jest z przyszłości.',
    vDateOk: 'Poprawna data.',
    vDobVsPesel: function (d) { return 'Niezgodna z numerem PESEL — z PESEL wynika ' + d + '.'; },
    vDobMatchesPesel: 'Zgodna z numerem PESEL.',
    vDobFuture: 'Data urodzenia jest z przyszłości.',
    vEmailOk: 'Format adresu poprawny.',
    vEmailFormat: 'To nie wygląda na adres e-mail.',
    vPhoneOk: 'Format numeru poprawny.',
    vPhoneFormat: 'Oczekiwany format to +48 i 9 cyfr.',
    vHouseOk: 'Format numeru poprawny.',
    vHouseFormat: 'Numer to zwykle cyfry i ewentualnie jedna litera (np. 5a).',
    vIntOk: 'Liczba całkowita.',
    vIntFormat: 'Wpisz liczbę.',
    vNoPeselConflict: 'Zaznaczono „brak PESEL", ale pole PESEL jest wypełnione.',
    vPeselMissingFlag: 'Pole PESEL jest puste, ale nie zaznaczono „brak PESEL".',
    vNoNipConflict: 'Zaznaczono „brak NIP", ale pole NIP jest wypełnione.',
    vNipMissingFlag: 'Pole NIP jest puste, ale nie zaznaczono „brak NIP".',

    /* --- statusy pól ---------------------------------------------------- */
    tierAuto: 'Auto',
    tierAbsentAuto: 'Brak · auto',
    tierCheck: 'Sprawdź',
    tierLow: 'Niepewne',
    tierError: 'Niezgodne',
    errorHint: 'Odczyt może być poprawny — na dokumencie bywają numery z błędem. ' +
               'Porównaj z dokumentem po lewej: jeśli zgadza się co do znaku, zachowaj wartość.',
    actKeepAsIs: 'Zgadza się z dokumentem — zachowaj',
    tierMissing: 'Brak odczytu',
    tierConfirmed: 'Potwierdzone',
    tierEdited: 'Poprawione',
    tierAbsent: 'Brak na dok.',
    tierOverride: 'Zgodnie z dok.',
    critical: 'krytyczne',

    /* --- pasek postępu i liczniki --------------------------------------- */
    progressPending: function (pending, flagged) { return 'Do decyzji: ' + pending + ' z ' + flagged; },
    progressAllDone: 'Wszystkie pola rozstrzygnięte',
    countErrors: 'błędy',
    countMissing: 'braki',
    countLow: 'niepewne',
    countCheck: 'do sprawdzenia',
    countAuto: 'auto',
    tabTodo: function (n) { return 'Wymagające uwagi (' + n + ')'; },
    tabAll: function (n) { return 'Wszystkie pola (' + n + ')'; },

    /* --- akcje ---------------------------------------------------------- */
    actAgree: 'Zgadza się',
    actApprove: 'Zatwierdź',
    actAbsent: 'Brak na dokumencie',
    actOverride: 'Zachowaj — tak jest na dokumencie',
    actUndo: 'Cofnij decyzję',
    sugMostLikely: 'najbardziej prawdopodobne',
    sugIfMisread: 'Jeśli to jednak błąd odczytu — najbliższe numery z poprawną sumą kontrolną',
    sugSwap: function (from, to) { return from + '→' + to; },
    sugBirth: function (d) { return 'ur. ' + d; },
    sugLetterFix: 'litera → cyfra · suma kontrolna poprawna',
    sugFromPesel: 'wyliczone z numeru PESEL',
    quickCommon: 'Częste wartości:',
    noReadout: 'brak odczytu',
    confNone: '—',
    confNoneTitle: 'Model nie podał pewności dla tego pola.',
    confAgreementTitle: 'Zgodność dwóch niezależnych odczytów tego pola. 100% = oba modele przeczytały dokładnie to samo.',

    /* --- druga opinia --------------------------------------------------- */
    phaseReading: function (n, of) {
      return of > 1 ? 'Odczytywanie dokumentu… (' + n + ' z ' + of + ')' : 'Odczytywanie dokumentu…';
    },
    phaseVerifying: function (n, of) {
      return 'Druga opinia — weryfikacja odczytu… (' + n + ' z ' + of + ')';
    },
    phaseBoth: 'Dwa niezależne odczyty równocześnie…',
    altRead: function (model) {
      var name = App.Config.modelById(model);
      return (name ? name.label : 'drugi model') + ' przeczytał inaczej';
    },
    altRead_empty: '(puste)',
    confSourceAgreement: function (model) {
      var name = App.Config.modelById(model);
      return 'Pewność zmierzona przez porównanie z modelem ' + (name ? name.label : model) +
             ' — 100% oznacza, że oba odczyty są identyczne.';
    },
    confSourceSelfReported: 'Pewność podana przez sam model jest zawodna — te modele podają niemal identyczną wartość dla każdego pola, więc paski pewności nie są pokazywane. Zaznacz „drugą opinię” przed odczytem, aby zmierzyć pewność porównaniem dwóch odczytów. Walidacja (sumy kontrolne, formaty, zgodność pól) działa niezależnie od tego.',
    weakPrimaryWarning: 'Uwaga: odczyt główny wykonał model 8B — najmniej dokładny. Na próbkach zdarzyło mu się wpisać zmyślony NIP w dokumencie, który go nie zawierał. Zwróć szczególną uwagę na numery identyfikacyjne.',
    verifyFailed: function (reason) {
      return 'Druga opinia się nie powiodła (' + reason + '). Pokazana pewność pochodzi od samego modelu i jest zawodna.';
    },
    criticalTitle: 'Pole krytyczne — wymaga wyższej pewności, zanim zostanie przyjęte automatycznie.',
    aiProposal: 'propozycja modelu',

    /* --- zakończenie ---------------------------------------------------- */
    finishRemaining: function (n) {
      return 'Zostało ' + n + ' ' + plural(n, 'pole', 'pola', 'pól');
    },
    finishApprove: 'Zatwierdź dokument',
    finishDone: 'Zatwierdzony ✓',
    toastAllResolved: 'Wszystkie pola rozstrzygnięte. Możesz zatwierdzić dokument.',
    toastApproved: 'Dokument zatwierdzony.',
    toastFixFirst: 'Popraw błąd albo wybierz „Zachowaj — tak jest na dokumencie".',
    toastValueFirst: 'Wpisz wartość albo wybierz „Brak na dokumencie".',
    hintEnter: 'zatwierdź pole',
    hintNext: 'następne do sprawdzenia',
    hintEsc: 'wyjdź z pola',

    /* --- eksport przeglądu ---------------------------------------------- */
    downloadReviewPrefix: 'przeglad',
    copyReview: 'Kopiuj JSON z przeglądem',
    reviewStatusApproved: 'approved',
    reviewStatusReady: 'ready',
    reviewStatusInProgress: 'in_progress'
  };
})(window.App);
