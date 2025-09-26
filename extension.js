import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const PING_INTERVAL = 1000; // 1 second
const HISTORY_LENGTH = 300; // 5 minutes at 1 second intervals

const PingIndicator = GObject.registerClass(
class PingIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Ping Monitor', false);

        this._settings = settings;
        this._pingHistory = [];
        this._pingTimeout = null;
        this._displayUpdateCounter = 0; // Counter for display updates
        this._settingsConnection = null; // Track settings connection
        this._menuOpenStateId = null; // Track menu state connection
        this._thresholdConnections = []; // Track threshold setting connections
        
        // Cache threshold values for performance
        this._thresholds = {
            low: 50,
            medium: 100,
            high: 200
        };
        this._updateThresholds();

        // Cache display settings
        this._showYAxisLabels = true;
        this._updateDisplaySettings();

        // Create the top bar label
        this._label = new St.Label({
            text: '-- ms',
            style_class: 'panel-button',
            y_align: Clutter.ActorAlign.CENTER
        });
        this.add_child(this._label);

        // Manually create the menu
        this.setMenu(new PopupMenu.PopupMenu(this, 0.0, St.Side.TOP));

        // Create popup menu with chart
        this._createMenu();

        // Connect threshold change listeners
        this._connectThresholdListeners();

        // Start ping monitoring
        this._startPingMonitoring();
    }

    _updateThresholds() {
        if (this._settings) {
            try {
                this._thresholds.low = this._settings.get_int('threshold-low');
                this._thresholds.medium = this._settings.get_int('threshold-medium');
                this._thresholds.high = this._settings.get_int('threshold-high');
            } catch (e) {
                console.warn('[Ping Extension] Failed to get thresholds, using defaults:', e);
                // Keep default values if settings fail
            }
        }
    }

    _updateDisplaySettings() {
        if (this._settings) {
            try {
                this._showYAxisLabels = this._settings.get_boolean('show-y-axis-labels');
            } catch (e) {
                console.warn('[Ping Extension] Failed to get display settings, using defaults:', e);
                // Keep default values if settings fail
            }
        }
    }

    _connectThresholdListeners() {
        if (!this._settings) return;

        // Store connection IDs for proper cleanup
        this._thresholdConnections = [
            this._settings.connect('changed::threshold-low', () => {
                this._updateThresholds();
            }),
            this._settings.connect('changed::threshold-medium', () => {
                this._updateThresholds();
            }),
            this._settings.connect('changed::threshold-high', () => {
                this._updateThresholds();
            }),
            this._settings.connect('changed::show-y-axis-labels', () => {
                this._updateDisplaySettings();
                // Redraw chart if menu is open
                if (this.menu?.isOpen && this._chartArea) {
                    this._chartArea.queue_repaint();
                }
            })
        ];
    }

    _createMenu() {
        // Check if menu is available
        if (!this.menu) {
            console.error('[Ping Extension] Menu is not available yet');
            return;
        }

        // Destroy previous menu if it exists (like TodoIt does)
        if (this._chartBox) {
            this._chartBox.destroy();
            this._chartBox = null;
        }

        // Create a scrollable area for the chart
        this._chartBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style: 'padding: 10px; min-width: 400px; min-height: 250px;',
            reactive: false  // Don't capture mouse events
        });

        // Chart title
        let title = new St.Label({
            text: 'Ping Times (5 minutes)',
            style_class: 'ping-chart-title'
        });
        this._chartBox.add_child(title);

        // Chart area
        this._chartArea = new St.DrawingArea({
            style_class: 'ping-chart-area',
            width: 380,
            height: 200,
            reactive: false  // Ensure it doesn't capture mouse events
        });
        this._chartArea.connect('repaint', this._drawChart.bind(this));
        this._chartBox.add_child(this._chartArea);

        // Stats
        this._statsLabel = new St.Label({
            text: 'No data yet',
            style_class: 'ping-stats-label'
        });
        this._chartBox.add_child(this._statsLabel);

        // Use PopupMenuSection instead for better menu behavior
        let menuSection = new PopupMenu.PopupMenuSection();
        menuSection.actor.add_child(this._chartBox);
        this.menu.addMenuItem(menuSection);

        // Connect menu open/close events for proper behavior
        this._menuOpenStateId = this.menu.connect('open-state-changed', (menu, open) => {
            if (open && this._chartArea) {
                // Menu opened - redraw chart
                this._chartArea.queue_repaint();
            }
        });
    }

    _startPingMonitoring() {
        this._pingTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PING_INTERVAL, () => {
            // Check if extension is still active before continuing
            if (!this._label || !this._pingHistory) {
                return GLib.SOURCE_REMOVE;
            }
            
            this._performPing();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _performPing() {
        // Early return if component is being destroyed
        if (!this._label || !this._pingHistory) {
            return;
        }

        try {
            // Get target host with fallback to default
            let targetHost = '1.1.1.1'; // default
            if (this._settings) {
                try {
                    targetHost = this._settings.get_string('target-host');
                } catch (e) {
                    console.warn('[Ping Extension] Failed to get target-host, using default:', e);
                }
            }

            let proc = Gio.Subprocess.new(
                ['ping', '-c', '1', '-W', '2', targetHost],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (proc, result) => {
                // Check if component still exists before processing result
                if (!this._label || !this._pingHistory) {
                    return;
                }

                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(result);
                    let success = proc.get_successful();

                    if (success && stdout) {
                        let match = stdout.match(/time=([0-9.]+)/);
                        if (match) {
                            let pingTime = parseFloat(match[1]);
                            this._addPingData(pingTime, true);
                            return;
                        }
                    }

                    // If we get here, ping failed
                    this._addPingData(null, false);
                } catch (e) {
                    console.warn('[Ping Extension] Error processing ping result:', e);
                    this._addPingData(null, false);
                }
            });
        } catch (e) {
            console.warn('[Ping Extension] Error starting ping process:', e);
            this._addPingData(null, false);
        }
    }

    _addPingData(pingTime, success) {
        let timestamp = Date.now();

        this._pingHistory.push({
            timestamp: timestamp,
            pingTime: pingTime,
            success: success
        });

        // Keep only last HISTORY_LENGTH entries
        if (this._pingHistory.length > HISTORY_LENGTH) {
            this._pingHistory.shift();
        }

        // Increment display counter
        this._displayUpdateCounter++;

        // Update top bar display only every 5 seconds (every 5th ping)
        if (this._displayUpdateCounter >= 5) {
            this._displayUpdateCounter = 0; // Reset counter
            
            if (success && pingTime !== null) {
                this._label.text = `${Math.round(pingTime)}ms`;
                
                // Color code based on configurable thresholds
                if (pingTime <= this._thresholds.low) {
                    this._label.style_class = 'ping-low ping-panel-label';
                } else if (pingTime <= this._thresholds.medium) {
                    this._label.style_class = 'ping-medium ping-panel-label';
                } else {
                    this._label.style_class = 'ping-high ping-panel-label';
                }
            } else {
                this._label.text = '-';
                this._label.style_class = 'ping-failed ping-panel-label';
            }
        }

        // Update stats
        this._updateStats();

        // Redraw chart if menu is open
        if (this.menu?.isOpen && this._chartArea) {
            this._chartArea.queue_repaint();
        }
    }

    _updateStats() {
        if (!this._statsLabel) {
            return; // Component not initialized yet
        }

        if (this._pingHistory.length === 0) {
            this._statsLabel.text = 'No data yet';
            return;
        }

        let successfulPings = this._pingHistory.filter(p => p.success);
        let successRate = (successfulPings.length / this._pingHistory.length * 100).toFixed(1);

        if (successfulPings.length > 0) {
            let times = successfulPings.map(p => p.pingTime);
            let avgPing = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1);
            let minPing = Math.min(...times).toFixed(1);
            let maxPing = Math.max(...times).toFixed(1);

            this._statsLabel.text =
                `Success: ${successRate}% | Avg: ${avgPing}ms | Min: ${minPing}ms | Max: ${maxPing}ms`;
        } else {
            this._statsLabel.text = `Success: ${successRate}% | No successful pings`;
        }
    }

    _drawChart(area) {
        // Safety check - ensure we have valid data and context
        if (!this._pingHistory || !area || this._pingHistory.length < 2) {
            return;
        }

        let cr = area.get_context();
        if (!cr) {
            return;
        }

        let [width, height] = area.get_surface_size();

        // Clear background
        cr.setSourceRGBA(0.16, 0.16, 0.16, 1.0);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        // Get successful pings for scaling
        let successfulPings = this._pingHistory.filter(p => p.success);
        if (successfulPings.length < 2) return;

        let pingTimes = successfulPings.map(p => p.pingTime);
        let minPing = Math.min(...pingTimes);
        let maxPing = Math.max(...pingTimes);

        // Add some padding to the range
        let range = maxPing - minPing;
        if (range < 10) range = 10; // Minimum range of 10ms
        let padding = range * 0.1;
        let chartMin = Math.max(0, minPing - padding);
        let chartMax = maxPing + padding;

        // Calculate chart area dimensions (reserve space for y-axis labels if enabled)
        let leftMargin = this._showYAxisLabels ? 50 : 10;
        let chartWidth = width - leftMargin - 10; // 10px right margin
        let chartHeight = height - 20; // 10px top and bottom margins
        let chartX = leftMargin;
        let chartY = 10;

        // Draw grid lines
        cr.setSourceRGBA(0.4, 0.4, 0.4, 0.5);
        cr.setLineWidth(0.5);

        // Horizontal grid lines (ping times)
        for (let i = 0; i <= 5; i++) {
            let y = chartY + (chartHeight * i / 5);
            cr.moveTo(chartX, y);
            cr.lineTo(chartX + chartWidth, y);
            cr.stroke();
        }

        // Vertical grid lines (time)
        for (let i = 0; i <= 10; i++) {
            let x = chartX + (chartWidth * i / 10);
            cr.moveTo(x, chartY);
            cr.lineTo(x, chartY + chartHeight);
            cr.stroke();
        }

        // Draw Y-axis labels if enabled
        if (this._showYAxisLabels) {
            cr.setSourceRGBA(0.8, 0.8, 0.8, 1.0);
            cr.selectFontFace('Sans', 0, 0); // Normal weight
            cr.setFontSize(10);

            for (let i = 0; i <= 5; i++) {
                let value = chartMax - (i * (chartMax - chartMin) / 5);
                let label = Math.round(value) + 'ms';
                let y = chartY + (chartHeight * i / 5);

                // Get text extents for alignment
                let textExtents = cr.textExtents(label);
                let textX = chartX - textExtents.width - 5;
                let textY = y + (textExtents.height / 2);

                cr.moveTo(textX, textY);
                cr.showText(label);
            }
        }

        // Draw ping line
        cr.setSourceRGBA(0.3, 0.7, 1.0, 1.0); // Light blue
        cr.setLineWidth(2);

        let firstPoint = true;
        for (let i = 0; i < this._pingHistory.length; i++) {
            let ping = this._pingHistory[i];

            let x = chartX + (i / (HISTORY_LENGTH - 1)) * chartWidth;

            if (ping.success) {
                let normalizedPing = (ping.pingTime - chartMin) / (chartMax - chartMin);
                let y = chartY + chartHeight - (normalizedPing * chartHeight);

                if (firstPoint) {
                    cr.moveTo(x, y);
                    firstPoint = false;
                } else {
                    cr.lineTo(x, y);
                }
            }
        }
        cr.stroke();

        // Draw failed ping markers
        cr.setSourceRGBA(1.0, 0.27, 0.21, 1.0); // Red
        for (let i = 0; i < this._pingHistory.length; i++) {
            let ping = this._pingHistory[i];
            if (!ping.success) {
                let x = chartX + (i / (HISTORY_LENGTH - 1)) * chartWidth;
                let y = chartY + chartHeight / 2; // Center vertically in chart area
                cr.arc(x, y, 3, 0, 2 * Math.PI);
                cr.fill();
            }
        }
    }

    destroy() {
        // Stop ping monitoring first
        if (this._pingTimeout) {
            GLib.source_remove(this._pingTimeout);
            this._pingTimeout = null;
        }

        // Clear any remaining ping data
        this._pingHistory = [];

        // Disconnect threshold listeners
        if (this._settings && this._thresholdConnections) {
            this._thresholdConnections.forEach(id => {
                this._settings.disconnect(id);
            });
            this._thresholdConnections = [];
        }

        // Clean up references
        if (this._settings) {
            this._settings = null;
        }

        // Call parent destroy
        super.destroy();
    }
});

export default class PingExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        
        // Initialize references to null (GJS best practice)
        this._settings = null;
        this._indicator = null;
        this._settingsConnection = null;
    }

    enable() {
        try {
            this._settings = this.getSettings('org.gnome.shell.extensions.ping');
        } catch (e) {
            console.error('[Ping Extension] Failed to load settings:', e);
            // Use defaults if settings fail to load
            this._settings = null;
        }

        this._indicator = new PingIndicator(this._settings);

        // Add to panel with proper error handling
        this._addToPanel();

        // Listen for position changes only if settings are available
        this._settingsConnection = null;
        if (this._settings) {
            this._settingsConnection = this._settings.connect('changed::panel-position', () => {
                this._repositionIndicator();
            });
        }
    }

    _addToPanel() {
        if (!this._indicator) return;

        try {
            // Remove from current position first if it has a parent
            const currentParent = this._indicator.get_parent();
            if (currentParent) {
                currentParent.remove_child(this._indicator);
            }

            // Get panel position from settings, with fallback
            let position = 'right'; // default
            if (this._settings) {
                try {
                    position = this._settings.get_string('panel-position');
                } catch (e) {
                    console.warn('[Ping Extension] Failed to get panel-position, using default:', e);
                }
            }

            // Ensure panel boxes are available
            if (!Main.panel._leftBox || !Main.panel._rightBox) {
                console.warn('[Ping Extension] Panel boxes not ready, retrying...');
                // Retry after a short delay
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._addToPanel();
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
            
            if (position === 'left') {
                // Add to left box at the end
                Main.panel._leftBox.add_child(this._indicator);
            } else {
                // Add to right box at the beginning
                Main.panel._rightBox.insert_child_at_index(this._indicator, 0);
            }
        } catch (e) {
            console.error('[Ping Extension] Failed to add indicator to panel:', e);
        }
    }

    _repositionIndicator() {
        if (!this._indicator) return;

        try {
            // Remove from current position
            const parent = this._indicator.get_parent();
            if (parent) {
                parent.remove_child(this._indicator);
            }

            // Get new position with fallback
            let position = 'right'; // default
            if (this._settings) {
                try {
                    position = this._settings.get_string('panel-position');
                } catch (e) {
                    console.warn('[Ping Extension] Failed to get panel-position during reposition, using default:', e);
                }
            }
            
            // Add to new position
            if (position === 'letleft') {
                // Add to left box at the end
                Main.panel._leftBox.add_child(this._indicator);
            } else {
                // Add to right box at the beginning
                Main.panel._rightBox.insert_child_at_index(this._indicator, 0);
            }
        } catch (e) {
            console.error('[Ping Extension] Failed to reposition indicator:', e);
        }
    }

    disable() {
        // Clean up timeout first to stop ping operations
        if (this._indicator && this._indicator._pingTimeout) {
            GLib.source_remove(this._indicator._pingTimeout);
            this._indicator._pingTimeout = null;
        }

        // Disconnect settings signal handler
        if (this._settingsConnection && this._settings) {
            this._settings.disconnect(this._settingsConnection);
            this._settingsConnection = null;
        }

        // Destroy UI components with proper cleanup
        if (this._indicator) {
            // Disconnect menu signals first
            if (this._indicator._menuOpenStateId && this._indicator.menu) {
                this._indicator.menu.disconnect(this._indicator._menuOpenStateId);
                this._indicator._menuOpenStateId = null;
            }

            // Clean up individual UI components
            if (this._indicator._chartArea) {
                this._indicator._chartArea.destroy();
                this._indicator._chartArea = null;
            }

            if (this._indicator._chartBox) {
                this._indicator._chartBox.destroy();
                this._indicator._chartBox = null;
            }

            if (this._indicator._statsLabel) {
                this._indicator._statsLabel.destroy();
                this._indicator._statsLabel = null;
            }

            if (this._indicator._label) {
                this._indicator._label.destroy();
                this._indicator._label = null;
            }

            // Clear ping history to prevent memory leaks
            this._indicator._pingHistory = [];

            // Finally destroy the main indicator
            this._indicator.destroy();
            this._indicator = null;
        }

        // Clear all references (GJS best practice)
        this._settings = null;
        this._settingsConnection = null;
    }
}