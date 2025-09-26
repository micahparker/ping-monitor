import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PingExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
    const settings = this.getSettings('org.gnome.shell.extensions.ping');

    // Create a preferences page
    const page = new Adw.PreferencesPage({
        title: 'General',
        icon_name: 'dialog-information-symbolic',
    });
    window.add(page);

    // Create a preferences group
    const group = new Adw.PreferencesGroup({
        title: 'Panel Settings',
        description: 'Configure the appearance and behavior of the ping indicator',
    });
    page.add(group);

    // Create the panel position row
    const panelPositionRow = new Adw.ComboRow({
        title: 'Panel Position',
        subtitle: 'Choose where the ping indicator appears in the top panel',
    });

    const positionModel = new Gtk.StringList();
    positionModel.append('Right');
    positionModel.append('Left');
    panelPositionRow.set_model(positionModel);

    // Set current selection based on settings
    const currentPosition = settings.get_string('panel-position');
    panelPositionRow.set_selected(currentPosition === 'right' ? 0 : 1);

    // Connect the signal to update settings when selection changes
    panelPositionRow.connect('notify::selected', (widget) => {
        const selectedIndex = widget.get_selected();
        const newPosition = selectedIndex === 0 ? 'right' : 'left';
        settings.set_string('panel-position', newPosition);
    });

    group.add(panelPositionRow);

    // Create the target host row
    const targetHostRow = new Adw.EntryRow({
        title: 'Target Host',
        text: settings.get_string('target-host'),
    });

    targetHostRow.connect('notify::text', (widget) => {
        const newHost = widget.get_text().trim();
        if (newHost) {
            settings.set_string('target-host', newHost);
        }
    });

    group.add(targetHostRow);

    // Create a preferences group for thresholds
    const thresholdGroup = new Adw.PreferencesGroup({
        title: 'Ping Thresholds',
        description: 'Configure color thresholds for different ping times (in milliseconds)',
    });
    page.add(thresholdGroup);

    // Create the low threshold row
    const lowThresholdRow = new Adw.SpinRow({
        title: 'Low Threshold',
        subtitle: 'Ping times below this value will be displayed in white',
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 1000,
            step_increment: 1,
            page_increment: 10,
            value: settings.get_int('threshold-low'),
        }),
    });

    lowThresholdRow.connect('notify::value', (widget) => {
        const newValue = widget.get_value();
        settings.set_int('threshold-low', newValue);
    });

    thresholdGroup.add(lowThresholdRow);

    // Create the medium threshold row
    const mediumThresholdRow = new Adw.SpinRow({
        title: 'Medium Threshold',
        subtitle: 'Ping times above low but below this value will be displayed in orange',
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 2000,
            step_increment: 1,
            page_increment: 10,
            value: settings.get_int('threshold-medium'),
        }),
    });

    mediumThresholdRow.connect('notify::value', (widget) => {
        const newValue = widget.get_value();
        settings.set_int('threshold-medium', newValue);
    });

    thresholdGroup.add(mediumThresholdRow);

    // Create the high threshold row
    const highThresholdRow = new Adw.SpinRow({
        title: 'High Threshold',
        subtitle: 'Ping times above this value will be displayed in red',
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 5000,
            step_increment: 1,
            page_increment: 10,
            value: settings.get_int('threshold-high'),
        }),
    });

    highThresholdRow.connect('notify::value', (widget) => {
        const newValue = widget.get_value();
        settings.set_int('threshold-high', newValue);
    });

    thresholdGroup.add(highThresholdRow);

    // Create a preferences group for display settings
    const displayGroup = new Adw.PreferencesGroup({
        title: 'Display Settings',
        description: 'Configure the appearance of the ping chart',
    });
    page.add(displayGroup);

    // Create the y-axis labels toggle row
    const yAxisLabelsRow = new Adw.SwitchRow({
        title: 'Show Y-Axis Labels',
        subtitle: 'Display ping time values on the Y-axis of the chart',
        active: settings.get_boolean('show-y-axis-labels'),
    });

    yAxisLabelsRow.connect('notify::active', (widget) => {
        const newValue = widget.get_active();
        settings.set_boolean('show-y-axis-labels', newValue);
    });

    displayGroup.add(yAxisLabelsRow);
    }
}