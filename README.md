# Ημερολόγιο ΟΜΗ για GitHub Pages

Η δημόσια σελίδα αθλητών διαβάζει το `calendar.json`. Η διαχείριση αποθηκεύει ολόκληρο το πρόχειρο στον browser της συσκευής και δημιουργεί το δημόσιο JSON με ρητή εξαγωγή. Ο κώδικας, η αυτοματοποιημένη ανάπτυξη και το δημόσιο αρχείο χρησιμοποιούν το υπάρχον αποθετήριο `heraklion-bridge/calendar`. Η καθημερινή χρήση λειτουργεί δωρεάν. Η δημοσίευση γίνεται από χρήστη με δικαίωμα εγγραφής στο GitHub.

- [Εγχειρίδιο καθημερινής χρήσης](MANUAL.el.md)
- [Δημοσίευση και επαναφορά](PUBLISH.el.md)
- [Αρχιτεκτονική και γνωστοί περιορισμοί](ARCHITECTURE.md)

## Δοκιμή πριν από την ενεργοποίηση

Στην εκτέλεση **Calendar tests** του pull request, κατεβάστε το artifact **omh-static-review** και αποσυμπιέστε το. Ανοίξτε το `site/admin.html` με διπλό κλικ. Είναι αυτοτελές HTML, με ενσωματωμένα CSS, JavaScript και λογότυπο. Μπορείτε να δημιουργήσετε συνθετικές εγγραφές και να εξαγάγετε ένα δοκιμαστικό `calendar.json`. Η εξαγωγή παραμένει τοπική.

Για έλεγχο της δημόσιας προβολής, εξυπηρετήστε τον κατάλογο `site` με έναν τοπικό στατικό HTTP server. Το αρχικό JSON είναι κενό. Οι αυτοματοποιημένες δοκιμές browser ελέγχουν τη δημόσια σελίδα με συνθετικές δημοσιεύσεις σε προσωρινό τοπικό HTTP server και τη διαχείριση και από `file://`.

```bash
npm ci
npm run validate
npm test
npm run build -- --empty
npx playwright install chromium
npm run test:browser
```

Για σύστημα με Chromium, μπορείτε να ορίσετε `CHROMIUM_PATH`. Η εφαρμογή Pages δεν χρειάζεται Node.js σε λειτουργία. Το Node.js 24 χρησιμοποιείται για το build, τις δοκιμές και προαιρετικά το τοπικό εργαλείο δημοσίευσης.

## Ενεργοποίηση από εξουσιοδοτημένο διαχειριστή

Μετά την έγκριση της έκδοσης και τη συγχώνευση στο `main`:

1. Στο [Settings → Pages](https://github.com/heraklion-bridge/calendar/settings/pages), επιλέξτε **GitHub Actions** ως πηγή και ενεργοποιήστε το HTTPS όταν είναι διαθέσιμο.
2. Στο [Settings → Secrets and variables → Actions](https://github.com/heraklion-bridge/calendar/settings/variables/actions), δημιουργήστε μεταβλητή repository `OMH_PAGES_ENABLED` με τιμή `1`. Η μεταβλητή ενεργοποιεί την ανάπτυξη του workflow για το `main`.
3. Στο [workflow GitHub Pages](https://github.com/heraklion-bridge/calendar/actions/workflows/pages.yml), πατήστε **Run workflow** για το `main`. Περιμένετε την επιτυχή ανάπτυξη.
4. Ανοίξτε το [δημόσιο ημερολόγιο](https://heraklion-bridge.github.io/calendar/) και τη [διαχείριση](https://heraklion-bridge.github.io/calendar/admin.html). Ελέγξτε πρώτα το κενό αρχείο ή χρησιμοποιήστε τη διαδικασία αποδοχής με συνθετικά δεδομένα.

Το workflow επικυρώνει το JSON πριν από την ανάπτυξη και εξυπηρετεί το επικυρωμένο στιγμιότυπο με τα μεταδεδομένα της ανάπτυξης. Η δημόσια διεύθυνση και οι τυπικοί runners των GitHub Actions στο δημόσιο αποθετήριο καλύπτονται από τα δωρεάν όρια. [Όρια GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) · [Χρήση Actions](https://docs.github.com/en/actions/concepts/billing-and-usage)
