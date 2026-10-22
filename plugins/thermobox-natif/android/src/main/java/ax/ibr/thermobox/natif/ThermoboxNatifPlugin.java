package ax.ibr.thermobox.natif;

import android.content.Context;
import android.content.DialogInterface;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.os.Build;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.view.ContextThemeWrapper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.material.badge.BadgeDrawable;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton;
import com.google.android.material.navigation.NavigationBarView;
import com.google.android.material.snackbar.Snackbar;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Composants natifs Material 3 de Thermobox, posés par-dessus la page web (WebView) :
 * <ul>
 *   <li>la barre de navigation du bas (NavigationBarView / BottomNavigationView) : indicateur
 *   pilule, ondes, badges et retour haptique du système ;</li>
 *   <li>le bouton d'action principal de la page (ExtendedFloatingActionButton), qui se réduit à son
 *   icône quand on fait défiler la page vers le bas ;</li>
 *   <li>les notifications (Snackbar) et les confirmations (MaterialAlertDialog).</li>
 * </ul>
 * La page web garde tout le reste. Les couleurs viennent de la page (thème ThermoBox, clair ou
 * sombre, teinte de l'état) : l'application reste ThermoBox, les composants sont ceux d'Android.
 *
 * Événements : « onglet » ({ id, retouche }), « fab », « hauteur » ({ hauteur } en px CSS : place
 * prise en bas de l'écran par la barre, système compris).
 */
@CapacitorPlugin(name = "ThermoboxNatif")
public class ThermoboxNatifPlugin extends Plugin {

    private static final Map<String, Integer> ICONES = new HashMap<>();

    static {
        ICONES.put("apercu", R.drawable.tb_apercu);
        ICONES.put("salles", R.drawable.tb_salles);
        ICONES.put("mesures", R.drawable.tb_mesures);
        ICONES.put("gerer", R.drawable.tb_gerer);
        ICONES.put("utilisateurs", R.drawable.tb_utilisateurs);
        ICONES.put("maj", R.drawable.tb_maj);
        ICONES.put("plus", R.drawable.tb_plus);
        ICONES.put("compte", R.drawable.tb_compte);
        ICONES.put("ajouter", R.drawable.tb_ajouter);
        ICONES.put("ajouter_personne", R.drawable.tb_ajouter_personne);
    }

    @Nullable private BottomNavigationView barre;
    @Nullable private ExtendedFloatingActionButton fab;
    private final List<String> onglets = new ArrayList<>();
    /** La sélection vient de la page : pas d'événement « onglet » en retour. */
    private boolean selectionParLaPage = false;
    private boolean barreVisible = false;
    private boolean fabVisible = false;
    private boolean sombre = false;
    private int derniereHauteur = -1;

    // ------------------------------------------------------------------ helpers

    /** Contexte Material 3 (l'application est en AppCompat), clair ou sombre comme la page. */
    private Context contexte() {
        int theme = sombre
            ? com.google.android.material.R.style.Theme_Material3_Dark_NoActionBar
            : com.google.android.material.R.style.Theme_Material3_Light_NoActionBar;
        return new ContextThemeWrapper(getActivity(), theme);
    }

    private FrameLayout conteneur() {
        return getActivity().findViewById(android.R.id.content);
    }

    private int px(float dp) {
        return Math.round(dp * getContext().getResources().getDisplayMetrics().density);
    }

    private float versCss(int px) {
        return px / getContext().getResources().getDisplayMetrics().density;
    }

    /** « #RRGGBB » ou « #AARRGGBB » ; [defaut] si absente ou illisible. */
    private static int couleur(@Nullable JSObject couleurs, String cle, int defaut) {
        if (couleurs == null) return defaut;
        String v = couleurs.getString(cle);
        if (v == null || v.isEmpty()) return defaut;
        try {
            return Color.parseColor(v);
        } catch (IllegalArgumentException e) {
            return defaut;
        }
    }

    private static ColorStateList selon(int actif, int normal) {
        return new ColorStateList(new int[][] { { android.R.attr.state_checked }, {} }, new int[] { actif, normal });
    }

    private void ui(Runnable r) {
        getActivity().runOnUiThread(r);
    }

    // ------------------------------------------------------------------ navigation bar

    /**
     * onglets : [{ id, label, icone, badge }], actif : id ou null, visible, sombre,
     * couleurs : { fond, normal, actif, indicateur, badge }.
     */
    @PluginMethod
    public void configurerBarre(PluginCall call) {
        JSArray liste = call.getArray("onglets", new JSArray());
        String actif = call.getString("actif");
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        JSObject couleurs = call.getObject("couleurs");
        Boolean modeSombre = call.getBoolean("sombre");
        ui(() -> {
            try {
                if (modeSombre != null && modeSombre != sombre) {
                    // Les vues sont recréées dans le bon thème (ondes, états)
                    sombre = modeSombre;
                    retirer(barre);
                    barre = null;
                }
                BottomNavigationView b = obtenirBarre();
                remplir(b, liste);
                colorer(b, couleurs);
                selectionner(b, actif);
                montrer(visible);
                call.resolve(hauteur());
            } catch (JSONException | RuntimeException e) {
                call.reject("Barre de navigation : " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void selectionnerOnglet(PluginCall call) {
        String id = call.getString("id");
        ui(() -> {
            if (barre != null) selectionner(barre, id);
            call.resolve();
        });
    }

    @PluginMethod
    public void afficherBarre(PluginCall call) {
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        ui(() -> {
            montrer(visible);
            call.resolve(hauteur());
        });
    }

    private BottomNavigationView obtenirBarre() {
        if (barre != null) return barre;
        BottomNavigationView b = new BottomNavigationView(contexte());
        b.setLabelVisibilityMode(NavigationBarView.LABEL_VISIBILITY_LABELED);
        b.setElevation(0);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        b.setOnItemSelectedListener(item -> {
            if (!selectionParLaPage) {
                b.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                envoyerOnglet(item, false);
            }
            return true;
        });
        b.setOnItemReselectedListener(item -> envoyerOnglet(item, true));
        b.addOnLayoutChangeListener((v, l, t, r, bas, ol, ot, or, ob) -> {
            signalerHauteur();
            placerFab();
        });
        b.setVisibility(View.GONE);
        conteneur().addView(b, lp);
        barre = b;
        return b;
    }

    private void envoyerOnglet(MenuItem item, boolean retouche) {
        int i = item.getItemId();
        if (i < 0 || i >= onglets.size()) return;
        JSObject data = new JSObject();
        data.put("id", onglets.get(i));
        data.put("retouche", retouche);
        notifyListeners("onglet", data);
    }

    private void remplir(BottomNavigationView b, JSArray liste) throws JSONException {
        List<JSONObject> items = new ArrayList<>();
        for (int i = 0; i < liste.length(); i++) items.add(liste.getJSONObject(i));
        List<String> ids = new ArrayList<>();
        for (JSONObject o : items) ids.add(o.getString("id"));
        Menu menu = b.getMenu();
        // Same tabs: only the labels, icons and badges change (no flicker)
        if (!ids.equals(onglets)) {
            menu.clear();
            onglets.clear();
            onglets.addAll(ids);
            for (int i = 0; i < items.size(); i++) menu.add(Menu.NONE, i, i, items.get(i).optString("label"));
        }
        for (int i = 0; i < items.size(); i++) {
            JSONObject o = items.get(i);
            MenuItem item = menu.findItem(i);
            item.setTitle(o.optString("label"));
            Integer icone = ICONES.get(o.optString("icone"));
            item.setIcon(icone != null ? icone : R.drawable.tb_plus);
            if (o.optBoolean("badge", false)) {
                BadgeDrawable badge = b.getOrCreateBadge(i);
                badge.setVisible(true);
                badge.clearNumber();
            } else {
                b.removeBadge(i);
            }
        }
    }

    private void colorer(BottomNavigationView b, @Nullable JSObject c) {
        int fond = couleur(c, "fond", sombre ? 0xFF1B2230 : 0xFFE7EEF8);
        int normal = couleur(c, "normal", sombre ? 0xFFC3CBD8 : 0xFF4C6480);
        int actif = couleur(c, "actif", sombre ? 0xFFE3EAF6 : 0xFF0B2A57);
        int indicateur = couleur(c, "indicateur", sombre ? 0xFF2E4A78 : 0xFFCFE0F8);
        int badge = couleur(c, "badge", 0xFFBA1A1A);
        b.setBackgroundColor(fond);
        b.setItemIconTintList(selon(actif, normal));
        b.setItemTextColor(selon(actif, normal));
        b.setItemActiveIndicatorColor(ColorStateList.valueOf(indicateur));
        for (int i = 0; i < onglets.size(); i++) {
            BadgeDrawable d = b.getBadge(i);
            if (d != null) d.setBackgroundColor(badge);
        }
        // Gesture bar / buttons of the system: same colour as the bar under them
        if (Build.VERSION.SDK_INT < 35) getActivity().getWindow().setNavigationBarColor(fond);
    }

    private void selectionner(BottomNavigationView b, @Nullable String id) {
        int i = id == null ? -1 : onglets.indexOf(id);
        selectionParLaPage = true;
        try {
            Menu menu = b.getMenu();
            if (i >= 0) {
                menu.setGroupCheckable(0, true, true);
                b.setSelectedItemId(i);
            } else {
                // A page that is not in the bar: no tab selected
                menu.setGroupCheckable(0, true, false);
                for (int k = 0; k < menu.size(); k++) menu.getItem(k).setChecked(false);
                menu.setGroupCheckable(0, true, true);
            }
        } finally {
            selectionParLaPage = false;
        }
    }

    private void montrer(boolean visible) {
        barreVisible = visible;
        BottomNavigationView b = barre;
        if (b != null) {
            if (visible) {
                if (b.getVisibility() != View.VISIBLE) {
                    b.setVisibility(View.VISIBLE);
                    b.setTranslationY(b.getHeight() > 0 ? b.getHeight() : px(80));
                }
                b.animate().translationY(0).setDuration(250).withEndAction(null).start();
            } else if (b.getVisibility() == View.VISIBLE) {
                b.animate().translationY(b.getHeight()).setDuration(200).withEndAction(() -> {
                    if (!barreVisible) b.setVisibility(View.GONE);
                    signalerHauteur();
                }).start();
            }
        }
        signalerHauteur();
        placerFab();
    }

    private JSObject hauteur() {
        JSObject r = new JSObject();
        BottomNavigationView b = barre;
        r.put("hauteur", b != null && barreVisible && b.getHeight() > 0 ? versCss(b.getHeight()) : 0);
        r.put("visible", barreVisible);
        return r;
    }

    private void signalerHauteur() {
        BottomNavigationView b = barre;
        int h = b != null && barreVisible ? b.getHeight() : 0;
        if (h == derniereHauteur) return;
        derniereHauteur = h;
        notifyListeners("hauteur", hauteur());
    }

    private static void retirer(@Nullable View v) {
        if (v != null && v.getParent() instanceof ViewGroup) ((ViewGroup) v.getParent()).removeView(v);
    }

    // ------------------------------------------------------------------ main action (FAB)

    /** visible, label, icone, etendu, couleurs : { fond, texte }. */
    @PluginMethod
    public void configurerFab(PluginCall call) {
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        String label = call.getString("label", "");
        String icone = call.getString("icone", "ajouter");
        Boolean etendu = call.getBoolean("etendu");
        JSObject couleurs = call.getObject("couleurs");
        ui(() -> {
            if (!visible) {
                fabVisible = false;
                if (fab != null) fab.hide();
                call.resolve();
                return;
            }
            ExtendedFloatingActionButton f = obtenirFab();
            f.setText(label);
            f.setContentDescription(label);
            Integer res = ICONES.get(icone);
            f.setIconResource(res != null ? res : R.drawable.tb_ajouter);
            int fond = couleur(couleurs, "fond", 0xFF2160CC);
            int texte = couleur(couleurs, "texte", Color.WHITE);
            f.setBackgroundTintList(ColorStateList.valueOf(fond));
            f.setTextColor(texte);
            f.setIconTint(ColorStateList.valueOf(texte));
            f.setRippleColor(ColorStateList.valueOf((texte & 0x00FFFFFF) | 0x33000000));
            if (etendu != null) {
                if (etendu) f.extend();
                else f.shrink();
            }
            fabVisible = true;
            placerFab();
            f.show();
            call.resolve();
        });
    }

    /** Scrolling down: the button shrinks to its icon; back up: it shows its label again. */
    @PluginMethod
    public void etendreFab(PluginCall call) {
        boolean etendu = Boolean.TRUE.equals(call.getBoolean("etendu", true));
        ui(() -> {
            if (fab != null) {
                if (etendu) fab.extend();
                else fab.shrink();
            }
            call.resolve();
        });
    }

    private ExtendedFloatingActionButton obtenirFab() {
        if (fab != null) return fab;
        ExtendedFloatingActionButton f = new ExtendedFloatingActionButton(contexte());
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
        lp.setMarginEnd(px(16));
        lp.bottomMargin = px(16);
        f.setOnClickListener(v -> notifyListeners("fab", new JSObject()));
        f.setVisibility(View.GONE);
        conteneur().addView(f, lp);
        fab = f;
        return f;
    }

    /** 16 dp above the navigation bar (or above the bottom of the screen without it). */
    private void placerFab() {
        ExtendedFloatingActionButton f = fab;
        if (f == null) return;
        BottomNavigationView b = barre;
        int bas = px(16) + (b != null && barreVisible ? b.getHeight() : 0);
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) f.getLayoutParams();
        if (lp.bottomMargin != bas) {
            lp.bottomMargin = bas;
            f.setLayoutParams(lp);
        }
    }

    // ------------------------------------------------------------------ snackbars and dialogs

    /** texte, longue : notification Material au-dessus de la barre et du bouton d'action. */
    @PluginMethod
    public void snackbar(PluginCall call) {
        String texte = call.getString("texte", "");
        boolean longue = Boolean.TRUE.equals(call.getBoolean("longue", false));
        ui(() -> {
            Snackbar s = Snackbar.make(conteneur(), texte, longue ? Snackbar.LENGTH_LONG : Snackbar.LENGTH_SHORT);
            if (fab != null && fabVisible) s.setAnchorView(fab);
            else if (barre != null && barreVisible) s.setAnchorView(barre);
            View vue = s.getView();
            vue.setOnClickListener(v -> s.dismiss());
            s.show();
            call.resolve();
        });
    }

    /** titre, message, confirmer, annuler, danger : { valeur: boolean }. */
    @PluginMethod
    public void confirmer(PluginCall call) {
        String titre = call.getString("titre", "");
        String message = call.getString("message", "");
        String oui = call.getString("confirmer", "Confirmer");
        String non = call.getString("annuler", "Annuler");
        boolean danger = Boolean.TRUE.equals(call.getBoolean("danger", false));
        ui(() -> {
            final boolean[] repondu = { false };
            DialogInterface.OnClickListener reponse = (d, quel) -> {
                repondu[0] = true;
                JSObject r = new JSObject();
                r.put("valeur", quel == DialogInterface.BUTTON_POSITIVE);
                call.resolve(r);
            };
            AlertDialog d = new MaterialAlertDialogBuilder(contexte())
                .setTitle(titre)
                .setMessage(message)
                .setPositiveButton(oui, reponse)
                .setNegativeButton(non, reponse)
                .setOnDismissListener(x -> {
                    if (repondu[0]) return;
                    JSObject r = new JSObject();
                    r.put("valeur", false);
                    call.resolve(r);
                })
                .show();
            if (danger) d.getButton(DialogInterface.BUTTON_POSITIVE).setTextColor(sombre ? 0xFFFFB4AB : 0xFFBA1A1A);
        });
    }

    @Override
    protected void handleOnDestroy() {
        retirer(barre);
        retirer(fab);
        barre = null;
        fab = null;
        super.handleOnDestroy();
    }
}
