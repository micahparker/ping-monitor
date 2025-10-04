import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const HISTORY_LENGTH = 300; // 5 minutes at 1 second intervals

export default class PingMonitorExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        
        // Initialize references to null (GJS best practice) - following TodoIt pattern
        this._settings = null;
        this._button = null;
        this._indicator = null;
        this._settingsConnection = null;
        this._pingHistory = [];
        this._pingTimeout = null;
        this._displayUpdateTimeout = null;
        this._displayUpdateCounter = 0;
        this._lastPingResult = null; // Store latest ping result for display updates
        this._menuOpenStateId = null;
        this._thresholdConnections = [];
        this._label = null;
        this._chartBox = null;
        this._chartArea = null;
        this._statsLabel = null;
        
        // Cache threshold values for performance
        this._thresholds = {
            low: 50,
            medium: 100,
            high: 200
        };

        // Cache interval settings
        this._pingInterval = 1000; // milliseconds
        this._displayUpdateInterval = 5000; // milliseconds

        // Cache display settings
        this._showYAxisLabels = true;
    }

    enable() {
        try {
            this._settings = this.getSettings();
        } catch (e) {
            console.error('[Ping Extension] Failed to load settings:', e);
            this._settings = null;
        }

        // Create button like TodoIt does - not extending PanelMenu.Button
        this._button = new PanelMenu.Button(0.0, 'Ping Monitor', false);
        
        this._updateThresholds();
        this._updateDisplaySettings();

        // Create the top bar label
        this._label = new St.Label({
            text: '-- ms',
            style_class: 'panel-button',
            y_align: Clutter.ActorAlign.CENTER
        });
        this._button.add_child(this._label);

        // Set indicator reference like TodoIt
        this._indicator = this._button;
        
        // Add to panel with proper error handling
        this._addToPanel();

        // Create popup menu with chart (using built-in menu like TodoIt)
        this._buildPopupMenu();

        // Connect threshold change listeners
        this._connectThresholdListeners();

        // Start ping monitoring
        this._startPingMonitoring();
        this._startDisplayUpdates();

        // Listen for position changes only if settings are available
        this._settingsConnection = null;
        if (this._settings) {
            try {
                this._settingsConnection = this._settings.connect('changed::panel-position', () => {
                    // Use a safer repositioning approach
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        if (this._indicator && this._settings) {
                            // Instead of complex repositioning, just recreate cleanly
                            if (Main.panel.statusArea[this.uuid]) {
                                delete Main.panel.statusArea[this.uuid];
                            }
                            this._addToPanel();
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                });
            } catch (e) {
                console.error('[Ping Extension] Failed to connect to panel-position settings:', e);
            }
        }
    }

    _updateThresholds() {
        if (this._settings) {
            try {
                this._thresholds.low = this._settings.get_int('threshold-low');
                this._thresholds.medium = this._settings.get_int('threshold-medium');
                this._thresholds.high = this._settings.get_int('threshold-high');
            } catch (e) {
                console.warn('[Ping Extension] Failed to get thresholds, using defaults:', e);
            }
        }
    }

    _updateDisplaySettings() {
        if (this._settings) {
            try {
                this._showYAxisLabels = this._settings.get_boolean('show-y-axis-labels');
                this._pingInterval = this._settings.get_int('ping-interval');
                this._displayUpdateInterval = this._settings.get_int('display-update-interval');
            } catch (e) {
                console.warn('[Ping Extension] Failed to get display settings, using defaults:', e);
            }
        }
    }

    _connectThresholdListeners() {
        if (!this._settings) return;

        try {
            this._thresholdConnections = [
                this._settings.connect('changed::threshold-low', () => {
                    if (this._settings) this._updateThresholds();
                }),
                this._settings.connect('changed::threshold-medium', () => {
                    if (this._settings) this._updateThresholds();
                }),
                this._settings.connect('changed::threshold-high', () => {
                    if (this._settings) this._updateThresholds();
                }),
                this._settings.connect('changed::show-y-axis-labels', () => {
                    if (this._settings) this._updateDisplaySettings();
                }),
                this._settings.connect('changed::ping-interval', () => {
                    if (this._settings) {
                        this._updateDisplaySettings();
                        this._restartPingMonitoring();
                    }
                }),
                this._settings.connect('changed::display-update-interval', () => {
                    if (this._settings) {
                        this._updateDisplaySettings();
                        this._restartPingMonitoring();
                    }
                })
            ];
        } catch (e) {
            console.error('[Ping Extension] Failed to connect threshold listeners:', e);
            this._thresholdConnections = [];
        }
    }

    _buildPopupMenu() {
        // Clear any existing menu content (like TodoIt does)
        this._button.menu.removeAll();

        // Destroy previous menu components if they exist (like TodoIt does)
        if (this._chartBox) {
            this._chartBox.destroy();
            this._chartBox = null;
        }

        // Create main box layout (like TodoIt's mainBox)
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

        // Add the main box to the menu (like TodoIt does)
        this._button.menu.box.add_child(this._chartBox);

        // Connect menu open/close events for proper behavior
        this._menuOpenStateId = this._button.menu.connect('open-state-changed', (menu, open) => {
            if (open && this._chartArea) {
                // Menu opened - redraw chart
                this._chartArea.queue_repaint();
                this._updateStats();
            }
        });
    }

    _addToPanel() {
        if (!this._indicator) return;

        try {
            // Get panel position from settings, with fallback
            let position = 'right'; // default
            if (this._settings) {
                try {
                    position = this._settings.get_string('panel-position');
                } catch (e) {
                    console.warn('[Ping Extension] Failed to get panel-position, using default:', e);
                }
            }

            // Position at end of each section: -1 for left (rightmost), 0 for right (leftmost)
            let index = (position === 'left') ? -1 : 0;
            Main.panel.addToStatusArea(this.uuid, this._indicator, index, position);
        } catch (e) {
            console.error('[Ping Extension] Failed to add to panel:', e);
        }
    }

    _repositionIndicator() {
        if (!this._indicator || !this._settings) {
            return;
        }

        try {
            // Get the new position from settings
            let newPosition = this._settings.get_string('panel-position') || 'right';
            
            // Get current position if it exists in status area
            let currentPosition = null;
            if (Main.panel.statusArea[this.uuid]) {
                // Check which panel section contains our indicator
                if (Main.panel._leftBox.get_children().includes(this._indicator)) {
                    currentPosition = 'left';
                } else if (Main.panel._centerBox.get_children().includes(this._indicator)) {
                    currentPosition = 'center';
                } else if (Main.panel._rightBox.get_children().includes(this._indicator)) {
                    currentPosition = 'right';
                }
            }

            // Only reposition if the position actually changed
            if (currentPosition !== newPosition) {
                console.log(`[Ping Extension] Repositioning from ${currentPosition} to ${newPosition}`);
                
                // Remove from status area cleanly
                if (Main.panel.statusArea[this.uuid]) {
                    delete Main.panel.statusArea[this.uuid];
                }
                
                // Remove from current parent
                const currentParent = this._indicator.get_parent();
                if (currentParent) {
                    currentParent.remove_child(this._indicator);
                }
                
                // Add to new position with proper index
                let index = (newPosition === 'left') ? -1 : 0;
                Main.panel.addToStatusArea(this.uuid, this._indicator, index, newPosition);
                console.log('[Ping Extension] Successfully repositioned to:', newPosition);
            }
        } catch (e) {
            console.error('[Ping Extension] Failed to reposition indicator:', e);
            // Don't try to recover, just log the error to prevent crashes
        }
    }

    _startPingMonitoring() {
        this._pingTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._pingInterval, () => {
            if (!this._label || !this._pingHistory) {
                return GLib.SOURCE_REMOVE;
            }
            
            this._performPing();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _startDisplayUpdates() {
        this._displayUpdateTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._displayUpdateInterval, () => {
            if (!this._label) {
                return GLib.SOURCE_REMOVE;
            }
            
            // Update display with latest ping result
            if (this._lastPingResult !== null) {
                this._updateDisplay(this._lastPingResult.pingTime);
            }
            
            return GLib.SOURCE_CONTINUE;
        });
    }

    _restartPingMonitoring() {
        // Stop current monitoring
        if (this._pingTimeout) {
            GLib.source_remove(this._pingTimeout);
            this._pingTimeout = null;
        }
        
        // Stop display updates
        if (this._displayUpdateTimeout) {
            GLib.source_remove(this._displayUpdateTimeout);
            this._displayUpdateTimeout = null;
        }
        
        // Start with new intervals
        this._startPingMonitoring();
        this._startDisplayUpdates();
    }

    _performPing() {
        if (!this._label || !this._pingHistory) {
            return;
        }

        try {
            let targetHost = '8.8.8.8'; // default
            if (this._settings) {
                try {
                    targetHost = this._settings.get_string('target-host') || '8.8.8.8';
                } catch (e) {
                    console.warn('[Ping Extension] Failed to get target-host, using default:', e);
                }
            }

            const startTime = GLib.get_monotonic_time();
            
            // Simple ping using subprocess
            let proc = Gio.Subprocess.new(
                ['ping', '-c', '1', '-W', '2', targetHost],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (proc, result) => {
                if (!this._label || !this._pingHistory) return;

                try {
                    let [, stdout, stderr] = proc.communicate_utf8_finish(result);
                    let success = proc.get_successful();
                    
                    if (success && stdout) {
                        // Parse ping time from output
                        let match = stdout.match(/time=([0-9.]+)\s*ms/);
                        if (match) {
                            let pingTime = parseFloat(match[1]);
                            this._addPingData(pingTime, true);
                            this._lastPingResult = { pingTime: pingTime, success: true };
                        } else {
                            this._addPingData(null, false);
                            this._lastPingResult = { pingTime: null, success: false };
                        }
                    } else {
                        this._addPingData(null, false);
                        this._lastPingResult = { pingTime: null, success: false };
                    }
                } catch (e) {
                    console.warn('[Ping Extension] Ping process error:', e);
                    this._addPingData(null, false);
                    this._lastPingResult = { pingTime: null, success: false };
                }
            });

        } catch (e) {
            console.error('[Ping Extension] Failed to start ping process:', e);
            this._addPingData(null, false);
            this._lastPingResult = { pingTime: null, success: false };
        }
    }

    _addPingData(pingTime, success) {
        if (!this._pingHistory) return;

        this._pingHistory.push({
            time: GLib.get_monotonic_time() / 1000,
            pingTime: pingTime,
            success: success
        });

        // Keep only recent history
        while (this._pingHistory.length > HISTORY_LENGTH) {
            this._pingHistory.shift();
        }

        // Update chart and stats if they exist
        if (this._chartArea) {
            this._chartArea.queue_repaint();
        }
        this._updateStats();
    }

    _updateDisplay(pingTime) {
        if (!this._label) return;

        try {
            if (pingTime !== null) {
                let color = this._getPingColor(pingTime);
                this._label.set_text(`${Math.round(pingTime)}ms`);
                this._label.set_style(`color: ${color};`);
            } else {
                this._label.set_text('--ms');
                this._label.set_style('color: #ff4444;');
            }
        } catch (e) {
            console.error('[Ping Extension] Failed to update display:', e);
        }
    }

    _getPingColor(pingTime) {
        if (pingTime <= this._thresholds.low) {
            return '#44ff44'; // green
        } else if (pingTime <= this._thresholds.medium) {
            return '#ffff44'; // yellow  
        } else if (pingTime <= this._thresholds.high) {
            return '#ff8844'; // orange
        } else {
            return '#ff4444'; // red
        }
    }

    disable() {
        // Stop ping monitoring
        if (this._pingTimeout) {
            GLib.source_remove(this._pingTimeout);
            this._pingTimeout = null;
        }

        // Stop display updates
        if (this._displayUpdateTimeout) {
            GLib.source_remove(this._displayUpdateTimeout);
            this._displayUpdateTimeout = null;
        }

        // Disconnect threshold listeners
        this._thresholdConnections.forEach(id => {
            if (this._settings) {
                this._settings.disconnect(id);
            }
        });
        this._thresholdConnections = [];

        // Disconnect settings signal handler
        if (this._settingsConnection && this._settings) {
            this._settings.disconnect(this._settingsConnection);
            this._settingsConnection = null;
        }

        // Destroy UI components with proper cleanup like TodoIt
        if (this._indicator) {
            if (this._menuOpenStateId && this._button?.menu) {
                this._button.menu.disconnect(this._menuOpenStateId);
                this._menuOpenStateId = null;
            }

            if (this._chartArea) {
                this._chartArea.destroy();
                this._chartArea = null;
            }

            if (this._chartBox) {
                this._chartBox.destroy();
                this._chartBox = null;
            }

            if (this._statsLabel) {
                this._statsLabel.destroy();
                this._statsLabel = null;
            }

            if (this._label) {
                this._label.destroy();
                this._label = null;
            }

            // Clear ping history to prevent memory leaks
            this._pingHistory = [];

            // Remove from status area and cleanup properly
            if (Main.panel.statusArea[this.uuid]) {
                delete Main.panel.statusArea[this.uuid];
            }

            // Finally destroy the main indicator
            this._indicator.destroy();
            this._indicator = null;
        }

        // Clear all references (GJS best practice) like TodoIt
        this._settings = null;
        this._settingsConnection = null;
        this._button = null;
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
}