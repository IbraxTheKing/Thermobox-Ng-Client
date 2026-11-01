package ax.ibr.thermobox.natif;

import android.animation.ValueAnimator;
import android.content.Context;
import android.content.DialogInterface;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.os.Build;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.BackEventCompat;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.view.ContextThemeWrapper;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.widget.NestedScrollView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.material.badge.BadgeDrawable;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.bottomsheet.BottomSheetDragHandleView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton;
import com.google.android.material.navigation.NavigationBarView;
import com.google.android.material.navigationrail.NavigationRailView;
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
 *   <li>la navigation (NavigationBarView) : la barre du bas sur un téléphone tenu droit
 *   (BottomNavigationView), un rail à gauche sur une tablette ou un téléphone tenu de côté
 *   (NavigationRailView), comme le rail d'icônes de l'interface sur ordinateur ; indicateur
 *   pilule, ondes, badges et retour haptique du système ;</li>
 *   <li>le bouton d'action principal de la page (ExtendedFloatingActionButton), qui se réduit à son
 *   icône quand on fait défiler la page vers le bas ;</li>
 *   <li>les menus des feuilles (BottomSheetDialog : poignée, glisser pour fermer, retour), les
 *   notifications (Snackbar) et les confirmations (MaterialAlertDialog).</li>
 * </ul>
 * La page web garde tout le reste. Les couleurs viennent de la page (thème ThermoBox, clair ou
 * sombre, teinte de l'état) : l'application reste ThermoBox, les composants sont ceux d'Android.
 *
 * Événements : « onglet » ({ id, retouche }), « fab », « hauteur » ({ hauteur, largeur } en px
 * CSS : place prise en bas de l'écran par la barre, système compris, ou à gauche par le rail), « retour » ({ etape, progres, bord, y }).
 *
 * Retour (geste ou bouton) : une fois activé par la page (activerRetour), le plugin le prend
 * avant l'activité et le décrit à la page étape par étape (« debut », « progres » de 0 à 1 pendant
 * que le doigt glisse depuis le bord, « annule », « valide »), comme le retour prédictif
 * d'Android 14+ : la page rétrécit sous le doigt, puis revient en arrière. Avant Android 14, ou
 * avec le bouton retour, seule l'étape « valide » arrive.
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
        ICONES.put("voir", R.drawable.tb_voir);
        ICONES.put("ouvrir", R.drawable.tb_ouvrir);
        ICONES.put("modifier", R.drawable.tb_modifier);
        ICONES.put("detacher", R.drawable.tb_detacher);
        ICONES.put("supprimer", R.drawable.tb_supprimer);
        ICONES.put("cle", R.drawable.tb_cle);
        ICONES.put("deplacer", R.drawable.tb_deplacer);
        ICONES.put("etoile", R.drawable.tb_etoile);
        ICONES.put("coche", R.drawable.tb_coche);
        ICONES.put("maison", R.drawable.tb_maison);
        ICONES.put("reglages", R.drawable.tb_reglages);
    }

    @Nullable private NavigationBarView barre;
    /** « bas » (barre du bas) ou « rail » (rail à gauche). */
    private String mode = "bas";
    private int derniereLargeur = -1;
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
     * couleurs : { fond, normal, actif, indicateur, badge }, mode : « bas » (5 onglets au plus) ou
     * « rail » (7 au plus).
     */
    @PluginMethod
    public void configurerBarre(PluginCall call) {
        JSArray liste = call.getArray("onglets", new JSArray());
        String actif = call.getString("actif");
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        JSObject couleurs = call.getObject("couleurs");
        Boolean modeSombre = call.getBoolean("sombre");
        String modeVoulu = "rail".equals(call.getString("mode")) ? "rail" : "bas";
        ui(() -> {
            try {
                boolean autreTheme = modeSombre != null && modeSombre != sombre;
                if (autreTheme || !modeVoulu.equals(mode)) {
                    // Les vues sont recréées dans le bon thème (ondes, états) ou sous l'autre forme
                    if (modeSombre != null) sombre = modeSombre;
                    mode = modeVoulu;
                    if (fondanime != null) fondanime.cancel();
                    fondBarre = null;
                    derniereLargeur = -1;
                    retirer(barre);
                    barre = null;
                    // The new bar has no tabs yet: filled again below (it stayed empty, then
                    // hidden, when the same tabs were thought to be there already)
                    onglets.clear();
                    derniereHauteur = -1;
                }
                NavigationBarView b = obtenirBarre();
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

    private NavigationBarView obtenirBarre() {
        if (barre != null) return barre;
        NavigationBarView b;
        FrameLayout.LayoutParams lp;
        if ("rail".equals(mode)) {
            // Tablet, phone held sideways: the rail of icons of the computers, on the left
            NavigationRailView r = new NavigationRailView(contexte());
            r.setMenuGravity(Gravity.TOP | Gravity.CENTER_HORIZONTAL);
            r.setItemMinimumHeight(px(60));
            // Under the status bar, above the bar of the system, beside a notch: its own padding
            ViewCompat.setOnApplyWindowInsetsListener(r, (v, insets) -> {
                Insets s = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                v.setPadding(s.left, s.top + px(12), 0, s.bottom);
                return insets;
            });
            b = r;
            lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.START);
        } else {
            b = new BottomNavigationView(contexte());
            lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        }
        b.setLabelVisibilityMode(NavigationBarView.LABEL_VISIBILITY_LABELED);
        b.setElevation(0);
        b.setOnItemSelectedListener(item -> {
            if (!selectionParLaPage) {
                b.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                envoyerOnglet(item, false);
            }
            return true;
        });
        // setSelectedItemId() on the tab already selected (the page sets its tab again on every
        // change of theme or colour) reports a « reselection »: only a real tap scrolls to the top
        b.setOnItemReselectedListener(item -> {
            if (!selectionParLaPage) envoyerOnglet(item, true);
        });
        b.addOnLayoutChangeListener((v, l, t, r, bas, ol, ot, or, ob) -> {
            signalerHauteur();
            placerFab();
        });
        b.setVisibility(View.GONE);
        conteneur().addView(b, lp);
        barre = b;
        return b;
    }

    private boolean enRail() {
        return barre instanceof NavigationRailView;
    }

    private void envoyerOnglet(MenuItem item, boolean retouche) {
        int i = item.getItemId();
        if (i < 0 || i >= onglets.size()) return;
        JSObject data = new JSObject();
        data.put("id", onglets.get(i));
        data.put("retouche", retouche);
        notifyListeners("onglet", data);
    }

    private void remplir(NavigationBarView b, JSArray liste) throws JSONException {
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

    private void colorer(NavigationBarView b, @Nullable JSObject c) {
        int fond = couleur(c, "fond", sombre ? 0xFF1B2230 : 0xFFE7EEF8);
        int normal = couleur(c, "normal", sombre ? 0xFFC3CBD8 : 0xFF4C6480);
        int actif = couleur(c, "actif", sombre ? 0xFFE3EAF6 : 0xFF0B2A57);
        int indicateur = couleur(c, "indicateur", sombre ? 0xFF2E4A78 : 0xFFCFE0F8);
        int badge = couleur(c, "badge", 0xFFBA1A1A);
        teindre(b, fond);
        b.setItemIconTintList(selon(actif, normal));
        b.setItemTextColor(selon(actif, normal));
        b.setItemActiveIndicatorColor(ColorStateList.valueOf(indicateur));
        for (int i = 0; i < onglets.size(); i++) {
            BadgeDrawable d = b.getBadge(i);
            if (d != null) d.setBackgroundColor(badge);
        }
    }

    /** Colour of the bar shown, and the fade towards a new one (the page fades the same way). */
    @Nullable private Integer fondBarre;
    @Nullable private ValueAnimator fondanime;

    /**
     * The bar takes the colour of the page: at once the first time, then fading as the page does
     * (« Maison »: a room tinted by its temperature, the dial being turned…).
     */
    private void teindre(NavigationBarView b, int fond) {
        if (fondanime != null) fondanime.cancel();
        Integer depuis = fondBarre;
        fondBarre = fond;
        if (depuis == null || depuis == fond || !b.isShown()) {
            poserFond(b, fond);
            return;
        }
        fondanime = ValueAnimator.ofArgb(depuis, fond);
        fondanime.setDuration(600);
        fondanime.addUpdateListener(a -> poserFond(b, (int) a.getAnimatedValue()));
        fondanime.start();
    }

    private void poserFond(NavigationBarView b, int fond) {
        b.setBackgroundColor(fond);
        // Gesture bar / buttons of the system: same colour as the bar under them (the page is
        // under them beside a rail)
        if (Build.VERSION.SDK_INT < 35 && !(b instanceof NavigationRailView)) getActivity().getWindow().setNavigationBarColor(fond);
    }

    private void selectionner(NavigationBarView b, @Nullable String id) {
        int i = id == null ? -1 : onglets.indexOf(id);
        selectionParLaPage = true;
        try {
            Menu menu = b.getMenu();
            if (i >= 0) {
                menu.setGroupCheckable(0, true, true);
                if (b.getSelectedItemId() != i || !menu.getItem(i).isChecked()) b.setSelectedItemId(i);
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
        NavigationBarView b = barre;
        if (b != null) {
            // The bar slides up from the bottom, the rail in from the left
            boolean rail = b instanceof NavigationRailView;
            if (visible) {
                if (b.getVisibility() != View.VISIBLE) {
                    b.setVisibility(View.VISIBLE);
                    if (rail) b.setTranslationX(-(b.getWidth() > 0 ? b.getWidth() : px(80)));
                    else b.setTranslationY(b.getHeight() > 0 ? b.getHeight() : px(80));
                }
                b.animate().translationX(0).translationY(0).setDuration(250).withEndAction(null).start();
            } else if (b.getVisibility() == View.VISIBLE) {
                (rail ? b.animate().translationX(-b.getWidth()) : b.animate().translationY(b.getHeight())).setDuration(200).withEndAction(() -> {
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
        NavigationBarView b = barre;
        boolean montree = b != null && barreVisible;
        r.put("hauteur", montree && !enRail() && b.getHeight() > 0 ? versCss(b.getHeight()) : 0);
        r.put("largeur", montree && enRail() && b.getWidth() > 0 ? versCss(b.getWidth()) : 0);
        r.put("visible", barreVisible);
        return r;
    }

    private void signalerHauteur() {
        NavigationBarView b = barre;
        boolean montree = b != null && barreVisible;
        int h = montree && !enRail() ? b.getHeight() : 0;
        int l = montree && enRail() ? b.getWidth() : 0;
        if (h == derniereHauteur && l == derniereLargeur) return;
        derniereHauteur = h;
        derniereLargeur = l;
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
        NavigationBarView b = barre;
        int bas = px(16) + (b != null && barreVisible && !enRail() ? b.getHeight() : 0);
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

    /**
     * titre, sousTitre, options : [{ id, label, icone, danger, coche }], couleurs : { fond, texte,
     * texteSecondaire, danger, accent } : { id } de la ligne choisie, null si le menu est fermé.
     * Sans icône : une liste de choix (un <select> de la page), celui en cours coché.
     */
    @PluginMethod
    public void menu(PluginCall call) {
        String titre = call.getString("titre", "");
        String sousTitre = call.getString("sousTitre", "");
        JSArray options = call.getArray("options", new JSArray());
        JSObject couleurs = call.getObject("couleurs");
        ui(() -> {
            try {
                Context ctx = contexte();
                int texte = couleur(couleurs, "texte", sombre ? 0xFFE3EAF6 : 0xFF1D3049);
                int secondaire = couleur(couleurs, "texteSecondaire", sombre ? 0xFFC3CBD8 : 0xFF4C6480);
                int rouge = couleur(couleurs, "danger", sombre ? 0xFFFFB4AB : 0xFFBA1A1A);
                int accent = couleur(couleurs, "accent", sombre ? 0xFFADC6FF : 0xFF2160CC);
                BottomSheetDialog dialogue = new BottomSheetDialog(ctx);
                final boolean[] repondu = { false };

                LinearLayout contenu = new LinearLayout(ctx);
                contenu.setOrientation(LinearLayout.VERTICAL);
                contenu.addView(new BottomSheetDragHandleView(ctx));
                if (!titre.isEmpty()) {
                    TextView t = new TextView(ctx);
                    t.setText(titre);
                    t.setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_TitleLarge);
                    t.setTextColor(texte);
                    t.setPadding(px(24), 0, px(24), sousTitre.isEmpty() ? px(12) : px(2));
                    contenu.addView(t);
                }
                if (!sousTitre.isEmpty()) {
                    TextView st = new TextView(ctx);
                    st.setText(sousTitre);
                    st.setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium);
                    st.setTextColor(secondaire);
                    st.setPadding(px(24), 0, px(24), px(12));
                    contenu.addView(st);
                }
                TypedValue fondLigne = new TypedValue();
                ctx.getTheme().resolveAttribute(android.R.attr.selectableItemBackground, fondLigne, true);
                // The rows scroll under the title (a long list: the bâtiments of a filter…)
                LinearLayout liste = new LinearLayout(ctx);
                liste.setOrientation(LinearLayout.VERTICAL);
                liste.setPadding(0, 0, 0, px(16));
                NestedScrollView defilement = new NestedScrollView(ctx);
                defilement.addView(liste, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                contenu.addView(defilement, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                for (int i = 0; i < options.length(); i++) {
                    JSONObject o = options.getJSONObject(i);
                    String id = o.getString("id");
                    boolean danger = o.optBoolean("danger", false);
                    // A list of choices (a <select> of the page): the current one is ticked
                    boolean coche = o.optBoolean("coche", false);
                    int couleurLigne = danger ? rouge : coche ? accent : texte;

                    LinearLayout ligne = new LinearLayout(ctx);
                    ligne.setOrientation(LinearLayout.HORIZONTAL);
                    ligne.setGravity(Gravity.CENTER_VERTICAL);
                    ligne.setMinimumHeight(px(56));
                    ligne.setPadding(px(24), 0, px(24), 0);
                    ligne.setBackgroundResource(fondLigne.resourceId);
                    ligne.setClickable(true);

                    // No icon given: a plain list of choices
                    String nomIcone = o.optString("icone", "");
                    if (!nomIcone.isEmpty()) {
                        ImageView icone = new ImageView(ctx);
                        Integer res = ICONES.get(nomIcone);
                        icone.setImageResource(res != null ? res : R.drawable.tb_ouvrir);
                        icone.setImageTintList(ColorStateList.valueOf(danger ? rouge : secondaire));
                        LinearLayout.LayoutParams lpIcone = new LinearLayout.LayoutParams(px(24), px(24));
                        lpIcone.setMarginEnd(px(16));
                        ligne.addView(icone, lpIcone);
                    }

                    TextView label = new TextView(ctx);
                    label.setText(o.optString("label"));
                    label.setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyLarge);
                    label.setTextColor(couleurLigne);
                    ligne.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

                    if (coche) {
                        ImageView marque = new ImageView(ctx);
                        marque.setImageResource(R.drawable.tb_coche);
                        marque.setImageTintList(ColorStateList.valueOf(accent));
                        LinearLayout.LayoutParams lpMarque = new LinearLayout.LayoutParams(px(24), px(24));
                        lpMarque.setMarginStart(px(16));
                        ligne.addView(marque, lpMarque);
                        ligne.setSelected(true);
                    }

                    ligne.setOnClickListener(v -> {
                        if (repondu[0]) return;
                        repondu[0] = true;
                        v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                        JSObject r = new JSObject();
                        r.put("id", id);
                        call.resolve(r);
                        dialogue.dismiss();
                    });
                    liste.addView(ligne, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                }
                dialogue.setContentView(contenu);
                dialogue.setOnDismissListener(d -> {
                    if (repondu[0]) return;
                    repondu[0] = true;
                    JSObject r = new JSObject();
                    r.put("id", (String) null);
                    call.resolve(r);
                });
                dialogue.setOnShowListener(d -> {
                    // ThermoBox colour of the sheet (the theme's would be Material's own)
                    View feuille = dialogue.findViewById(com.google.android.material.R.id.design_bottom_sheet);
                    if (feuille != null) {
                        feuille.setBackgroundTintList(ColorStateList.valueOf(
                            couleur(couleurs, "fond", sombre ? 0xFF1F2737 : 0xFFE3EAF5)));
                    }
                });
                dialogue.show();
            } catch (JSONException | RuntimeException e) {
                call.reject("Menu : " + e.getMessage(), e);
            }
        });
    }

    // ------------------------------------------------------------------ back (predictive)

    @Nullable private OnBackPressedCallback retour;

    /** actif : la page prend le retour (sinon : l'activité, c'est-à-dire Capacitor). */
    @PluginMethod
    public void activerRetour(PluginCall call) {
        boolean actif = Boolean.TRUE.equals(call.getBoolean("actif", true));
        ui(() -> {
            if (retour == null && actif && getActivity() instanceof ComponentActivity) {
                // Added last: called before the callback of the App plugin (backButton)
                retour = new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackStarted(@NonNull BackEventCompat e) {
                        envoyerRetour("debut", e);
                    }

                    @Override
                    public void handleOnBackProgressed(@NonNull BackEventCompat e) {
                        envoyerRetour("progres", e);
                    }

                    @Override
                    public void handleOnBackCancelled() {
                        envoyerRetour("annule", null);
                    }

                    @Override
                    public void handleOnBackPressed() {
                        envoyerRetour("valide", null);
                    }
                };
                ((ComponentActivity) getActivity()).getOnBackPressedDispatcher().addCallback(retour);
            }
            if (retour != null) retour.setEnabled(actif);
            call.resolve();
        });
    }

    private void envoyerRetour(String etape, @Nullable BackEventCompat e) {
        JSObject d = new JSObject();
        d.put("etape", etape);
        if (e != null) {
            d.put("progres", e.getProgress());
            d.put("bord", e.getSwipeEdge() == BackEventCompat.EDGE_RIGHT ? "droite" : "gauche");
            d.put("y", versCss(Math.round(e.getTouchY())));
        }
        notifyListeners("retour", d);
    }

    @Override
    protected void handleOnDestroy() {
        if (retour != null) retour.remove();
        retour = null;
        retirer(barre);
        retirer(fab);
        barre = null;
        fab = null;
        super.handleOnDestroy();
    }
}
