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
    }
}