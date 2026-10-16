package com.igniteclubhq.app;

import android.graphics.Color;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Paints the window behind transparent system bars on Android 15/16. */
@CapacitorPlugin(name = "StatusBarBackdrop")
public class StatusBarBackdropPlugin extends Plugin {
    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        String color = call.getString("color");
        if (color == null) {
            call.reject("A background colour is required");
            return;
        }
        final int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException error) {
            call.reject("Invalid background colour");
            return;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().getDecorView().setBackgroundColor(parsed);
            call.resolve();
        });
    }
}