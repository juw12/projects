package io.github.juw12.vitals;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Vitals' own plugin: lets the dashboard check this phone (storage, memory, battery, heat).
        registerPlugin(VitalsPhonePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
