var _       = require("underscore")._,
    async   = require("async"),
    fs      = require("fs"),
    exec    = require("child_process").exec,
    config  = require("../config.json");

// Better template format
_.templateSettings = {
    interpolate: /\{\{(.+?)\}\}/g,
    evaluate :   /\{\[([\s\S]+?)\]\}/g
};

// Helper function to write a given template to a file based on a given
// context
function write_template_to_file(template_path, file_name, context, callback) {
    async.waterfall([

        function read_template_file(next_step) {
            fs.readFile(template_path, {encoding: "utf8"}, next_step);
        },

        function update_file(file_txt, next_step) {
            var template = _.template(file_txt);
            fs.writeFile(file_name, template(context), next_step);
        }

    ], callback);
}

/*****************************************************************************\
    Return a set of functions which we can use to manage and check our wifi
    connection information
\*****************************************************************************/
module.exports = function() {
    // Detect which wifi driver we should use, the rtl871xdrv or the nl80211
    exec("iw list", function(error, stdout, stderr) {
        if (stderr.match(/^nl80211 not found/)) {
            config.wifi_driver_type = "rtl871xdrv";
        }
    });

    // Hack: this just assumes that the outbound interface will be "wlan0"

    // Define some globals
    var ifconfig_fields = {
        "hw_addr":         /HWaddr\s([^\s]+)/,
        "inet_addr":       /inet addr:([^\s]+)/,
    },  iwconfig_fields = {
        "ap_addr":         /Access Point:\s([^\s]+)/,
        "ap_ssid":         /ESSID:\"([^\"]+)\"/,
        "unassociated":    /(unassociated)\s+Nick/,
    },  last_wifi_info = null;

    // TODO: rpi-config-ap hardcoded, should derive from a constant

    // Get generic info on an interface
    var _get_wifi_info = function(callback) {
        var output = {
            hw_addr:      "<unknown>",
            inet_addr:    "<unknown>",
            ap_addr:      "<unknown_ap>",
            ap_ssid:      "<unknown_ssid>",
            unassociated: "<unknown>",
        };

        // Inner function which runs a given command and sets a bunch
        // of fields
        function run_command_and_set_fields(cmd, fields, callback) {
            exec(cmd, function(error, stdout, stderr) {
                if (error) return callback(error);
                for (var key in fields) {
                    re = stdout.match(fields[key]);
                    if (re && re.length > 1) {
                        output[key] = re[1];
                    }
                }
                callback(null);
            });
        }

        // Run a bunch of commands and aggregate info
        async.series([
            function run_ifconfig(next_step) {
                run_command_and_set_fields("ifconfig wlan0", ifconfig_fields, next_step);
            },
            function run_iwconfig(next_step) {
                run_command_and_set_fields("iwconfig wlan0", iwconfig_fields, next_step);
            },
        ], function(error) {
            last_wifi_info = output;
            return callback(error, output);
        });
    },

    _reboot_wireless_network = function(wlan_iface, callback) {
        async.series([
            function down(next_step) {
                exec("sudo ifdown " + wlan_iface, function(error, stdout, stderr) {
                    if (!error) console.log("ifdown " + wlan_iface + " successful...");
                    next_step();
                });
            },
            function up(next_step) {
                exec("sudo ifup " + wlan_iface, function(error, stdout, stderr) {
                    if (!error) console.log("ifup " + wlan_iface + " successful...");
                    next_step();
                });
            },
        ], callback);
    },

    // Wifi related functions
    _is_wifi_enabled_sync = function(info) {
        // If we are not an AP, and we have a valid
        // inet_addr - wifi is enabled!
        if (null        == _is_ap_enabled_sync(info) &&
            "<unknown>" != info["inet_addr"]         &&
            "<unknown>" == info["unassociated"] ) {
            return info["inet_addr"];
        }
        return null;
    },

    _is_wifi_enabled = function(callback) {
        _get_wifi_info(function(error, info) {
            if (error) return callback(error, null);
            return callback(null, _is_wifi_enabled_sync(info));
        });
    },

    // Access Point related functions
    _is_ap_enabled_sync = function(info) {
        // If the current IP assigned to the chosen wireless interface is
        // the one specified for the access point in the config, we are in
        // access-point mode.
        // var is_ap  =
        //     info["inet_addr"].toLowerCase() == info["ap_addr"].toLowerCase() &&
        //     info["ap_ssid"] == config.access_point.ssid;
        // NOTE: I used to detect this using the "ESSID" and "Access Point"
        //       members from if/iwconfig.  These have been removed when the
        //       interface is running as an access-point itself.  To cope with
        //       this we are taking the simple way out, but at the cost that
        //       if you join a wifi network with the same subnet, you could
        //       collide and have the pi think that it is still in AP mode.
        var is_ap = info["inet_addr"] == config.access_point.ip_addr;
        return (is_ap) ? info["inet_addr"].toLowerCase() : null;
    },

    _is_ap_enabled = function(callback) {
        _get_wifi_info(function(error, info) {
            if (error) return callback(error, null);
            return callback(null, _is_ap_enabled_sync(info));
        });
    },

    // Enables the accesspoint w/ bcast_ssid. This assumes that both
    // isc-dhcp-server and hostapd are installed using:
    // $sudo npm run-script provision
    _enable_ap_mode = function(bcast_ssid, callback) {
        _is_ap_enabled(function(error, result_addr) {
            if (error) {
                console.log("ERROR: " + error);
                return callback(error);
            }

            if (result_addr && !config.access_point.force_reconfigure) {
                console.log("\nAccess point is enabled with ADDR: " + result_addr);
                return callback(null);
            } else if (config.access_point.force_reconfigure) {
                console.log("\nForce reconfigure enabled - reset AP");
            } else {
                console.log("\nAP is not enabled yet... enabling...");
            }

            var context = config.access_point;
            context["enable_ap"] = true;
            context["wifi_driver_type"] = config.wifi_driver_type;

            // Here we need to actually follow the steps to enable the ap
            async.series([

              // create_ap is already running, but we need to stop wpa_supplicant
              function stop_wpa_supplicant_service(next_step) {
                  exec("systemctl stop wpa_supplicant.service", function(error, stdout, stderr) {
                      //console.log(stdout);
                      if (!error) console.log("... wpa_supplicant stopped!");
                      next_step();
                  });
              },
              // create_ap is already running, but we need to stop wpa_supplicant
              function start_ap_service(next_step) {
                  exec("systemctl start create_ap", function(error, stdout, stderr) {
                      //console.log(stdout);
                      if (!error) console.log("... create_ap started!");
                      next_step();
                  });
              },


            ], callback);
        });
    },

    // Disables AP mode and reverts to wifi connection
    _enable_wifi_mode = function(connection_info, callback) {

        _is_wifi_enabled(function(error, result_ip) {
            if (error) return callback(error);

            if (result_ip) {
                console.log("\nWifi connection is enabled with IP: " + result_ip);
                return callback(null);
            }

            async.series([

              // Stop create_ap...
              function stop_ap_service(next_step) {
                  exec("service create_ap stop", function(error, stdout, stderr) {
                      console.log(stdout);
                      if (!error) console.log("... create_ap stopped!");
                      next_step();
                  });
              },

                // Add SSID to wpa_supplicant...
                function update_interfaces(next_step) {
                    exec("wpa_passphrase \"" + connection_info.wifi_ssid + "\" \"" + connection_info.wifi_passcode + "\" > /etc/wpa_supplicant/wpa_supplicant.conf", function(error, stdout, stderr) {
                        console.log(stdout);
                        if (!error) console.log("... saved to wpa_supplicant");
                        next_step();
                    });
                },

                // Start wpa_supplicant...
                function start_wpa_supplicant(next_step) {
                    exec("systemctl start wpa_supplicant.service", function(error, stdout, stderr) {
                        console.log(stdout);
                        if (!error) console.log("... started wpa_supplicant service");
                        next_step();
                    });
                },

                // Get IP from dhclient...
                function update_dhcp(next_step) {
                    exec("dhclient wlan0", function(error, stdout, stderr) {
                        console.log(stdout);
                        if (!error) console.log("... dhclient acquired IP address");
                        next_step();
                    });
                },

                function reboot_network_interfaces(next_step) {
                    _reboot_wireless_network(config.wifi_interface, next_step);
                },

            ], callback);
        });

    };

    return {
        get_wifi_info:           _get_wifi_info,
        reboot_wireless_network: _reboot_wireless_network,

        is_wifi_enabled:         _is_wifi_enabled,
        is_wifi_enabled_sync:    _is_wifi_enabled_sync,

        is_ap_enabled:           _is_ap_enabled,
        is_ap_enabled_sync:      _is_ap_enabled_sync,

        enable_ap_mode:          _enable_ap_mode,
        enable_wifi_mode:        _enable_wifi_mode,
    };
}
