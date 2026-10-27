package ax.ibr.thermobox.plugin;

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
 * Native Material 3 components of Thermobox, laid over the web page (WebView):
 * <ul>
 *   <li>the navigation (NavigationBarView): the bar at the bottom of a phone held upright
 *   (BottomNavigationView), a rail on the left of a tablet or of a phone held sideways
 *   (NavigationRailView), as the rail of icons of the interface on a computer; pill indicator,
 *   ripples, badges and haptic feedback of the system;</li>
 *   <li>the main action of the page (ExtendedFloatingActionButton), which shrinks to its icon while
 *   the page scrolls down;</li>
 *   <li>the menus of the sheets (BottomSheetDialog: handle, swipe to close, back), the
 *   notifications (Snackbar) and the confirmations (MaterialAlertDialog).</li>
 * </ul>
 * The web page keeps everything else. The colours come from the page (ThermoBox theme, light or
 * dark, tint of the state): the app stays ThermoBox, the components are Android's.
 *
 * Events: "tab" ({ id, repeated }), "fab", "size" ({ height, width } in CSS px: room taken at the
 * bottom of the screen by the bar, system bar included, or on the left by the rail), "back"
 * ({ step, progress, edge, y }).
 *
 * Back (gesture or button): once enabled by the page (enableBack), the plugin takes it before the
 * activity and describes it to the page step by step ("start", "progress" from 0 to 1 while the
 * finger slides from the edge, "cancel", "commit"), as the predictive back of Android 14+: the page
 * shrinks under the finger, then goes back. Before Android 14, or with the back button, only the
 * "commit" step comes.
 */
@CapacitorPlugin(name = "ThermoboxNative")
public class ThermoboxNativePlugin extends Plugin {

    /** Drawables of the plugin, by the name the page gives (core/android-native.ts). */
    private static final Map<String, Integer> ICONS = new HashMap<>();

    static {
        ICONS.put("overview", R.drawable.tb_overview);
        ICONS.put("rooms", R.drawable.tb_rooms);
        ICONS.put("measurements", R.drawable.tb_measurements);
        ICONS.put("manage", R.drawable.tb_manage);
        ICONS.put("users", R.drawable.tb_users);
        ICONS.put("updates", R.drawable.tb_updates);
        ICONS.put("server", R.drawable.tb_server);
        ICONS.put("more", R.drawable.tb_more);
        ICONS.put("account", R.drawable.tb_account);
        ICONS.put("add", R.drawable.tb_add);
        ICONS.put("add_person", R.drawable.tb_add_person);
        ICONS.put("view", R.drawable.tb_view);
        ICONS.put("open", R.drawable.tb_open);
        ICONS.put("edit", R.drawable.tb_edit);
        ICONS.put("detach", R.drawable.tb_detach);
        ICONS.put("delete", R.drawable.tb_delete);
        ICONS.put("key", R.drawable.tb_key);
        ICONS.put("move", R.drawable.tb_move);
        ICONS.put("star", R.drawable.tb_star);
        ICONS.put("check", R.drawable.tb_check);
        ICONS.put("home", R.drawable.tb_home);
        ICONS.put("settings", R.drawable.tb_settings);
    }

    @Nullable private NavigationBarView bar;
    /** "bottom" (bar at the bottom) or "rail" (rail on the left). */
    private String mode = "bottom";
    private int lastWidth = -1;
    @Nullable private ExtendedFloatingActionButton fab;
    private final List<String> tabs = new ArrayList<>();
    /** The selection comes from the page: no "tab" event back. */
    private boolean selectionByPage = false;
    private boolean barVisible = false;
    private boolean fabVisible = false;
    private boolean dark = false;
    private int lastHeight = -1;

    // ------------------------------------------------------------------ helpers

    /** Material 3 context (the app is AppCompat), light or dark as the page. */
    private Context context() {
        int theme = dark
            ? com.google.android.material.R.style.Theme_Material3_Dark_NoActionBar
            : com.google.android.material.R.style.Theme_Material3_Light_NoActionBar;
        return new ContextThemeWrapper(getActivity(), theme);
    }

    private FrameLayout container() {
        return getActivity().findViewById(android.R.id.content);
    }

    private int px(float dp) {
        return Math.round(dp * getContext().getResources().getDisplayMetrics().density);
    }

    private float toCss(int px) {
        return px / getContext().getResources().getDisplayMetrics().density;
    }

    /** "#RRGGBB" or "#AARRGGBB"; [fallback] when missing or unreadable. */
    private static int color(@Nullable JSObject colors, String key, int fallback) {
        if (colors == null) return fallback;
        String v = colors.getString(key);
        if (v == null || v.isEmpty()) return fallback;
        try {
            return Color.parseColor(v);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    private static ColorStateList checkedOr(int active, int normal) {
        return new ColorStateList(new int[][] { { android.R.attr.state_checked }, {} }, new int[] { active, normal });
    }

    private void ui(Runnable r) {
        getActivity().runOnUiThread(r);
    }

    // ------------------------------------------------------------------ navigation bar

    /**
     * tabs: [{ id, label, icon, badge }], active: id or null, visible, dark,
     * colors: { background, normal, active, indicator, badge }, mode: "bottom" (5 tabs at most) or
     * "rail" (7 at most).
     */
    @PluginMethod
    public void configureBar(PluginCall call) {
        JSArray list = call.getArray("tabs", new JSArray());
        String active = call.getString("active");
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        JSObject colors = call.getObject("colors");
        Boolean darkMode = call.getBoolean("dark");
        String wantedMode = "rail".equals(call.getString("mode")) ? "rail" : "bottom";
        ui(() -> {
            try {
                boolean otherTheme = darkMode != null && darkMode != dark;
                if (otherTheme || !wantedMode.equals(mode)) {
                    // The views are made again in the right theme (ripples, states) or in the other form
                    if (darkMode != null) dark = darkMode;
                    mode = wantedMode;
                    if (backgroundAnimator != null) backgroundAnimator.cancel();
                    barBackground = null;
                    lastWidth = -1;
                    remove(bar);
                    bar = null;
                    // The new bar has no tabs yet: filled again below (it stayed empty, then
                    // hidden, when the same tabs were thought to be there already)
                    tabs.clear();
                    lastHeight = -1;
                }
                NavigationBarView b = getBar();
                fill(b, list);
                paint(b, colors);
                select(b, active);
                show(visible);
                call.resolve(size());
            } catch (JSONException | RuntimeException e) {
                call.reject("Navigation bar: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void selectTab(PluginCall call) {
        String id = call.getString("id");
        ui(() -> {
            if (bar != null) select(bar, id);
            call.resolve();
        });
    }

    @PluginMethod
    public void showBar(PluginCall call) {
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        ui(() -> {
            show(visible);
            call.resolve(size());
        });
    }

    private NavigationBarView getBar() {
        if (bar != null) return bar;
        NavigationBarView b;
        FrameLayout.LayoutParams lp;
        if ("rail".equals(mode)) {
            // Tablet, phone held sideways: the rail of icons of the computers, on the left
            NavigationRailView r = new NavigationRailView(context());
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
            b = new BottomNavigationView(context());
            lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        }
        b.setLabelVisibilityMode(NavigationBarView.LABEL_VISIBILITY_LABELED);
        b.setElevation(0);
        b.setOnItemSelectedListener(item -> {
            if (!selectionByPage) {
                b.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                sendTab(item, false);
            }
            return true;
        });
        // setSelectedItemId() on the tab already selected (the page sets its tab again on every
        // change of theme or colour) reports a "reselection": only a real tap scrolls to the top
        b.setOnItemReselectedListener(item -> {
            if (!selectionByPage) sendTab(item, true);
        });
        b.addOnLayoutChangeListener((v, l, t, r, bottom, ol, ot, or, ob) -> {
            reportSize();
            placeFab();
        });
        b.setVisibility(View.GONE);
        container().addView(b, lp);
        bar = b;
        return b;
    }

    private boolean isRail() {
        return bar instanceof NavigationRailView;
    }

    private void sendTab(MenuItem item, boolean repeated) {
        int i = item.getItemId();
        if (i < 0 || i >= tabs.size()) return;
        JSObject data = new JSObject();
        data.put("id", tabs.get(i));
        data.put("repeated", repeated);
        notifyListeners("tab", data);
    }

    private void fill(NavigationBarView b, JSArray list) throws JSONException {
        List<JSONObject> items = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) items.add(list.getJSONObject(i));
        List<String> ids = new ArrayList<>();
        for (JSONObject o : items) ids.add(o.getString("id"));
        Menu menu = b.getMenu();
        // Same tabs: only the labels, icons and badges change (no flicker)
        if (!ids.equals(tabs)) {
            menu.clear();
            tabs.clear();
            tabs.addAll(ids);
            for (int i = 0; i < items.size(); i++) menu.add(Menu.NONE, i, i, items.get(i).optString("label"));
        }
        for (int i = 0; i < items.size(); i++) {
            JSONObject o = items.get(i);
            MenuItem item = menu.findItem(i);
            item.setTitle(o.optString("label"));
            Integer icon = ICONS.get(o.optString("icon"));
            item.setIcon(icon != null ? icon : R.drawable.tb_more);
            if (o.optBoolean("badge", false)) {
                BadgeDrawable badge = b.getOrCreateBadge(i);
                badge.setVisible(true);
                badge.clearNumber();
            } else {
                b.removeBadge(i);
            }
        }
    }

    private void paint(NavigationBarView b, @Nullable JSObject c) {
        int background = color(c, "background", dark ? 0xFF1B2230 : 0xFFE7EEF8);
        int normal = color(c, "normal", dark ? 0xFFC3CBD8 : 0xFF4C6480);
        int active = color(c, "active", dark ? 0xFFE3EAF6 : 0xFF0B2A57);
        int indicator = color(c, "indicator", dark ? 0xFF2E4A78 : 0xFFCFE0F8);
        int badge = color(c, "badge", 0xFFBA1A1A);
        tint(b, background);
        b.setItemIconTintList(checkedOr(active, normal));
        b.setItemTextColor(checkedOr(active, normal));
        b.setItemActiveIndicatorColor(ColorStateList.valueOf(indicator));
        for (int i = 0; i < tabs.size(); i++) {
            BadgeDrawable d = b.getBadge(i);
            if (d != null) d.setBackgroundColor(badge);
        }
    }

    /** Colour of the bar shown, and the fade towards a new one (the page fades the same way). */
    @Nullable private Integer barBackground;
    @Nullable private ValueAnimator backgroundAnimator;

    /**
     * The bar takes the colour of the page: at once the first time, then fading as the page does
     * (« Maison »: a room tinted by its temperature, the dial being turned…).
     */
    private void tint(NavigationBarView b, int background) {
        if (backgroundAnimator != null) backgroundAnimator.cancel();
        Integer from = barBackground;
        barBackground = background;
        if (from == null || from == background || !b.isShown()) {
            setBackground(b, background);
            return;
        }
        backgroundAnimator = ValueAnimator.ofArgb(from, background);
        backgroundAnimator.setDuration(600);
        backgroundAnimator.addUpdateListener(a -> setBackground(b, (int) a.getAnimatedValue()));
        backgroundAnimator.start();
    }

    private void setBackground(NavigationBarView b, int background) {
        b.setBackgroundColor(background);
        // Gesture bar / buttons of the system: same colour as the bar under them (the page is
        // under them beside a rail)
        if (Build.VERSION.SDK_INT < 35 && !(b instanceof NavigationRailView)) getActivity().getWindow().setNavigationBarColor(background);
    }

    private void select(NavigationBarView b, @Nullable String id) {
        int i = id == null ? -1 : tabs.indexOf(id);
        selectionByPage = true;
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
            selectionByPage = false;
        }
    }

    private void show(boolean visible) {
        barVisible = visible;
        NavigationBarView b = bar;
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
                    if (!barVisible) b.setVisibility(View.GONE);
                    reportSize();
                }).start();
            }
        }
        reportSize();
        placeFab();
    }

    private JSObject size() {
        JSObject r = new JSObject();
        NavigationBarView b = bar;
        boolean shown = b != null && barVisible;
        r.put("height", shown && !isRail() && b.getHeight() > 0 ? toCss(b.getHeight()) : 0);
        r.put("width", shown && isRail() && b.getWidth() > 0 ? toCss(b.getWidth()) : 0);
        r.put("visible", barVisible);
        return r;
    }

    private void reportSize() {
        NavigationBarView b = bar;
        boolean shown = b != null && barVisible;
        int h = shown && !isRail() ? b.getHeight() : 0;
        int w = shown && isRail() ? b.getWidth() : 0;
        if (h == lastHeight && w == lastWidth) return;
        lastHeight = h;
        lastWidth = w;
        notifyListeners("size", size());
    }

    private static void remove(@Nullable View v) {
        if (v != null && v.getParent() instanceof ViewGroup) ((ViewGroup) v.getParent()).removeView(v);
    }

    // ------------------------------------------------------------------ main action (FAB)

    /** visible, label, icon, extended, colors: { background, text }. */
    @PluginMethod
    public void configureFab(PluginCall call) {
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        String label = call.getString("label", "");
        String icon = call.getString("icon", "add");
        Boolean extended = call.getBoolean("extended");
        JSObject colors = call.getObject("colors");
        ui(() -> {
            if (!visible) {
                fabVisible = false;
                if (fab != null) fab.hide();
                call.resolve();
                return;
            }
            ExtendedFloatingActionButton f = getFab();
            f.setText(label);
            f.setContentDescription(label);
            Integer res = ICONS.get(icon);
            f.setIconResource(res != null ? res : R.drawable.tb_add);
            int background = color(colors, "background", 0xFF2160CC);
            int text = color(colors, "text", Color.WHITE);
            f.setBackgroundTintList(ColorStateList.valueOf(background));
            f.setTextColor(text);
            f.setIconTint(ColorStateList.valueOf(text));
            f.setRippleColor(ColorStateList.valueOf((text & 0x00FFFFFF) | 0x33000000));
            if (extended != null) {
                if (extended) f.extend();
                else f.shrink();
            }
            fabVisible = true;
            placeFab();
            f.show();
            call.resolve();
        });
    }

    /** Scrolling down: the button shrinks to its icon; back up: it shows its label again. */
    @PluginMethod
    public void expandFab(PluginCall call) {
        boolean extended = Boolean.TRUE.equals(call.getBoolean("extended", true));
        ui(() -> {
            if (fab != null) {
                if (extended) fab.extend();
                else fab.shrink();
            }
            call.resolve();
        });
    }

    private ExtendedFloatingActionButton getFab() {
        if (fab != null) return fab;
        ExtendedFloatingActionButton f = new ExtendedFloatingActionButton(context());
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
        lp.setMarginEnd(px(16));
        lp.bottomMargin = px(16);
        f.setOnClickListener(v -> notifyListeners("fab", new JSObject()));
        f.setVisibility(View.GONE);
        container().addView(f, lp);
        fab = f;
        return f;
    }

    /** 16 dp above the navigation bar (or above the bottom of the screen without it). */
    private void placeFab() {
        ExtendedFloatingActionButton f = fab;
        if (f == null) return;
        NavigationBarView b = bar;
        int bottom = px(16) + (b != null && barVisible && !isRail() ? b.getHeight() : 0);
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) f.getLayoutParams();
        if (lp.bottomMargin != bottom) {
            lp.bottomMargin = bottom;
            f.setLayoutParams(lp);
        }
    }

    // ------------------------------------------------------------------ snackbars and dialogs

    /** text, long: a Material notification above the bar and the action button. */
    @PluginMethod
    public void snackbar(PluginCall call) {
        String text = call.getString("text", "");
        boolean longer = Boolean.TRUE.equals(call.getBoolean("long", false));
        ui(() -> {
            Snackbar s = Snackbar.make(container(), text, longer ? Snackbar.LENGTH_LONG : Snackbar.LENGTH_SHORT);
            if (fab != null && fabVisible) s.setAnchorView(fab);
            else if (bar != null && barVisible && !isRail()) s.setAnchorView(bar);
            View view = s.getView();
            view.setOnClickListener(v -> s.dismiss());
            s.show();
            call.resolve();
        });
    }

    /** title, message, confirm, cancel, danger: { value: boolean }. */
    @PluginMethod
    public void confirm(PluginCall call) {
        String title = call.getString("title", "");
        String message = call.getString("message", "");
        String yes = call.getString("confirm", "Confirmer");
        String no = call.getString("cancel", "Annuler");
        boolean danger = Boolean.TRUE.equals(call.getBoolean("danger", false));
        ui(() -> {
            final boolean[] answered = { false };
            DialogInterface.OnClickListener answer = (d, which) -> {
                answered[0] = true;
                JSObject r = new JSObject();
                r.put("value", which == DialogInterface.BUTTON_POSITIVE);
                call.resolve(r);
            };
            AlertDialog d = new MaterialAlertDialogBuilder(context())
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(yes, answer)
                .setNegativeButton(no, answer)
                .setOnDismissListener(x -> {
                    if (answered[0]) return;
                    JSObject r = new JSObject();
                    r.put("value", false);
                    call.resolve(r);
                })
                .show();
            if (danger) d.getButton(DialogInterface.BUTTON_POSITIVE).setTextColor(dark ? 0xFFFFB4AB : 0xFFBA1A1A);
        });
    }

    /**
     * title, subtitle, options: [{ id, label, icon, danger, checked }], colors: { background, text,
     * secondaryText, danger, accent }: { id } of the row picked, null when the menu is dismissed.
     * Without icons: a list of choices (a <select> of the page), the current one ticked.
     */
    @PluginMethod
    public void menu(PluginCall call) {
        String title = call.getString("title", "");
        String subtitle = call.getString("subtitle", "");
        JSArray options = call.getArray("options", new JSArray());
        JSObject colors = call.getObject("colors");
        ui(() -> {
            try {
                Context ctx = context();
                int text = color(colors, "text", dark ? 0xFFE3EAF6 : 0xFF1D3049);
                int secondary = color(colors, "secondaryText", dark ? 0xFFC3CBD8 : 0xFF4C6480);
                int red = color(colors, "danger", dark ? 0xFFFFB4AB : 0xFFBA1A1A);
                int accent = color(colors, "accent", dark ? 0xFFADC6FF : 0xFF2160CC);
                BottomSheetDialog dialog = new BottomSheetDialog(ctx);
                final boolean[] answered = { false };

                LinearLayout content = new LinearLayout(ctx);
                content.setOrientation(LinearLayout.VERTICAL);
                content.addView(new BottomSheetDragHandleView(ctx));
                if (!title.isEmpty()) {
                    TextView t = new TextView(ctx);
                    t.setText(title);
                    t.setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_TitleLarge);
                    t.setTextColor(text);
                    t.setPadding(px(24), 0, px(24), subtitle.isEmpty() ? px(12) : px(2));
                    content.addView(t);
                }
                if (!subtitle.isEmpty()) {
                    TextView st = new TextView(ctx);
                    st.setText(subtitle);
                    st.setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium);
                    st.setTextColor(secondary);
                    st.setPadding(px(24), 0, px(24), px(12));
                    content.addView(st);
                }
                TypedValue rowBackground = new TypedValue();
                ctx.getTheme().resolveAttribute(android.R.attr.selectableItemBackground, rowBackground, true);
                // The rows scroll under the title (a long list: the buildings of a filter…)
                LinearLayout list = new LinearLayout(ctx);
                list.setOrientation(LinearLayout.VERTICAL);
                list.setPadding(0, 0, 0, px(16));
                NestedScrollView scrolling = new NestedScrollView(ctx);
                scrolling.addView(list, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                content.addView(scrolling, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                for (int i = 0; i < options.length(); i++) {
                    JSONObject o = options.getJSONObject(i);
                    String id = o.getString("id");
                    boolean danger = o.optBoolean("danger", false);
                    // A list of choices (a <select> of the page): the current one is ticked
                    boolean checked = o.optBoolean("checked", false);
                    int rowColor = danger ? red : checked ? accent : text;

                    LinearLayout row = new LinearLayout(ctx);
                    row.setOrientation(LinearLayout.HORIZONTAL);
                    row.setGravity(Gravity.CENTER_VERTICAL);
                    row.setMinimumHeight(px(56));
                    row.setPadding(px(24), 0, px(24), 0);
                    row.setBackgroundResource(rowBackground.resourceId);
                    row.setClickable(true);

                    // No icon given: a plain list of choices
                    String iconName = o.optString("icon", "");
                    if (!iconName.isEmpty()) {
                        ImageView icon = new ImageView(ctx);
                        Integer res = ICONS.get(iconName);
                        icon.setImageResource(res != null ? res : R.drawable.tb_open);
                        icon.setImageTintList(ColorStateList.valueOf(danger ? red : secondary));
                        LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(px(24), px(24));
                        iconLp.setMarginEnd(px(16));
                        row.addView(icon, iconLp);
                    }

                    TextView label = new TextView(ctx);
                    label.setText(o.optString("label"));
                    label.setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyLarge);
                    label.setTextColor(rowColor);
                    row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

                    if (checked) {
                        ImageView tick = new ImageView(ctx);
                        tick.setImageResource(R.drawable.tb_check);
                        tick.setImageTintList(ColorStateList.valueOf(accent));
                        LinearLayout.LayoutParams tickLp = new LinearLayout.LayoutParams(px(24), px(24));
                        tickLp.setMarginStart(px(16));
                        row.addView(tick, tickLp);
                        row.setSelected(true);
                    }

                    row.setOnClickListener(v -> {
                        if (answered[0]) return;
                        answered[0] = true;
                        v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                        JSObject r = new JSObject();
                        r.put("id", id);
                        call.resolve(r);
                        dialog.dismiss();
                    });
                    list.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                }
                dialog.setContentView(content);
                dialog.setOnDismissListener(d -> {
                    if (answered[0]) return;
                    answered[0] = true;
                    JSObject r = new JSObject();
                    r.put("id", (String) null);
                    call.resolve(r);
                });
                dialog.setOnShowListener(d -> {
                    // ThermoBox colour of the sheet (the theme's would be Material's own)
                    View sheet = dialog.findViewById(com.google.android.material.R.id.design_bottom_sheet);
                    if (sheet != null) {
                        sheet.setBackgroundTintList(ColorStateList.valueOf(
                            color(colors, "background", dark ? 0xFF1F2737 : 0xFFE3EAF5)));
                    }
                });
                dialog.show();
            } catch (JSONException | RuntimeException e) {
                call.reject("Menu: " + e.getMessage(), e);
            }
        });
    }

    // ------------------------------------------------------------------ back (predictive)

    @Nullable private OnBackPressedCallback back;

    /** Android 12+: the Material You accent drawn from the wallpaper, as #rrggbb (nothing before). */
    @PluginMethod
    public void systemAccent(PluginCall call) {
        JSObject r = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            int c = getContext().getColor(android.R.color.system_accent1_500);
            r.put("color", String.format("#%06x", 0xFFFFFF & c));
        }
        call.resolve(r);
    }

    /** active: the page takes the back gesture and button (otherwise: the activity, i.e. Capacitor). */
    @PluginMethod
    public void enableBack(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", true));
        ui(() -> {
            if (back == null && active && getActivity() instanceof ComponentActivity) {
                // Added last: called before the callback of the App plugin (backButton)
                back = new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackStarted(@NonNull BackEventCompat e) {
                        sendBack("start", e);
                    }

                    @Override
                    public void handleOnBackProgressed(@NonNull BackEventCompat e) {
                        sendBack("progress", e);
                    }

                    @Override
                    public void handleOnBackCancelled() {
                        sendBack("cancel", null);
                    }

                    @Override
                    public void handleOnBackPressed() {
                        sendBack("commit", null);
                    }
                };
                ((ComponentActivity) getActivity()).getOnBackPressedDispatcher().addCallback(back);
            }
            if (back != null) back.setEnabled(active);
            call.resolve();
        });
    }

    private void sendBack(String step, @Nullable BackEventCompat e) {
        JSObject d = new JSObject();
        d.put("step", step);
        if (e != null) {
            d.put("progress", e.getProgress());
            d.put("edge", e.getSwipeEdge() == BackEventCompat.EDGE_RIGHT ? "right" : "left");
            d.put("y", toCss(Math.round(e.getTouchY())));
        }
        notifyListeners("back", d);
    }

    @Override
    protected void handleOnDestroy() {
        if (back != null) back.remove();
        back = null;
        remove(bar);
        remove(fab);
        bar = null;
        fab = null;
        super.handleOnDestroy();
    }
}
