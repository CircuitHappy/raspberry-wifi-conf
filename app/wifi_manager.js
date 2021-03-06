var _             = require("underscore")._,
    async         = require("async"),
    fs            = require("fs"),
    exec          = require("child_process").exec,
    config        = require("../config.json"),
    box_info      = {
      software_version:   "unknown",
      system_version:     "unknown",
      beta_code:          ""
    };

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
        "inet_addr":       /inet\s([^\s]+)/,
    },  iwconfig_fields = {
        "ap_addr":         /Access Point:\s([^\s]+)/,
        "ap_ssid":         /ESSID:\"([^\"]+)\"/,
        "unassociated":    /(unassociated)\s+Nick/,
    },  last_wifi_info = null;

    // Get generic info on an interface
    var _get_wifi_info = function(callback) {
        var output = {
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

    // Write WiFi Conf status to files
    _write_wifi_status = function(status) {
        //clear wifi status file
        fs.truncate(config.wifi_status_path, 0, function(err) {
          if(err) {
            return console.log(err);
          }
        });
        //then write the new status to file
        fs.writeFile(config.wifi_status_path, status, function(err) {
          if(err) {
            return console.log(err);
          }
        });
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
        // If there is no IP address assigned, we need to start the AP
        var is_ap = info["inet_addr"] == "<unknown>";
        console.log("inet_addr is " + info["inet_addr"]);
        return (is_ap) ? info["inet_addr"].toLowerCase() : null;
    },

    _is_ap_enabled = function(callback) {
        _get_wifi_info(function(error, info) {
            if (error) return callback(error, null);
            return callback(null, _is_ap_enabled_sync(info));
        });
    },

    _is_ap_enabled_sync = function(info) {
        // If there is no IP address assigned, we need to start the AP
        var is_ap = info["inet_addr"] == "<unknown>";
        console.log("inet_addr is " + info["inet_addr"]);
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

            if (result_addr != "<unknown>") {
                console.log("\nAccess point is enabled with ADDR: " + result_addr);
                return callback(null);
            } else {
                console.log("\nAP is not enabled yet... enabling...");
            }

            var context = config.access_point;
            context["enable_ap"] = true;
            context["wifi_driver_type"] = config.wifi_driver_type;

            // Here we need to actually follow the steps to enable the ap
            async.series([

              function apply_hostname_to_ssid(next_step) {
                exec("hostname", function(error, stdout, stderr) {
                    console.log(stdout);
                    if (!error) {
                      config.access_point.ssid = stdout;
                      console.log("... SSID is " + config.access_point.ssid);
                    }
                    next_step();
                });
              },

              // Set up hostapd conf SSID
              function update_interfaces(next_step) {
                  write_template_to_file(
                      "/ch/current/www/ch-box-admin/assets/etc/hostapd/hostapd.conf.template",
                      "/etc/hostapd/hostapd.conf",
                      context, next_step);
              },

              // create_ap is already running, but we need to stop wpa_supplicant
              function create_uap0_interface(next_step) {
                  exec("iw dev wlan0 interface add uap0 type __ap", function(error, stdout, stderr) {
                      console.log(stdout);
                      if (!error) console.log("... uap0 interface created!");
                      next_step();
                  });
              },

              function create_nat_routing(next_step) {
                  exec("iptables -t nat -A POSTROUTING -o wlan0 -j MASQUERADE", function(error, stdout, stderr) {
                      console.log(stdout);
                      if (!error) console.log("... NAT routing created!");
                      next_step();
                  });
              },

              function start_uap0_link(next_step) {
                  exec("ip link set uap0 up", function(error, stdout, stderr) {
                      console.log(stdout);
                      if (!error) console.log("... uap0 link up");
                      next_step();
                  });
              },

              function set_uap0_ip_address_range(next_step) {
                  exec("ip addr add 192.168.4.1/24 broadcast 192.168.4.255 dev uap0", function(error, stdout, stderr) {
                      console.log(stdout);
                      if (!error) console.log("... uap0 IP address range set");
                      next_step();
                  });
              },

              function start_hostapd_service(next_step) {
                  exec("service hostapd start", function(error, stdout, stderr) {
                      console.log(stdout);
                      if (!error) console.log("... hostapd started");
                      next_step();
                  });
              },

              function start_dnsmasq_service(next_step) {
                  exec("service dnsmasq start", function(error, stdout, stderr) {
                      console.log(stdout);
                      if (!error) console.log("... dnsmasq started");
                      next_step();
                  });
              },

            ], callback);
        });
    },

    // Disables AP mode and reverts to wifi connection
    _enable_wifi_mode = function(connection_info, callback) {

        console.log("received connection_info: \"" + connection_info.wifi_ssid + "\" \"" + connection_info.wifi_passcode + "\"");
        _is_wifi_enabled(function(error, result_ip) {
            if (error) return callback(error);

            async.series([
                // Add SSID to wpa_supplicant...
                function update_interfaces(next_step) {
                    exec("wpa_passphrase \"" + connection_info.wifi_ssid + "\" \"" + connection_info.wifi_passcode + "\" >> /etc/wpa_supplicant/wpa_supplicant.conf", function(error, stdout, stderr) {
                        console.log(stdout);
                        if (!error) console.log("... saved to wpa_supplicant");
                        next_step();
                    });
                },

            ], callback);
        });

    },

    // Reboots the box
    _reboot = function(callback) {

          async.series([
              function write_boot_status_and_wait_to_reboot(next_step) {
                  _write_wifi_status("REBOOT");
                  setTimeout( function () {
                    exec("sync;sync;sync;sleep 1;shutdown -r now", function(error, stdout, stderr) {
                    //exec("shutdown -r now", function(error, stdout, stderr) {
                        console.log(stdout);
                        if (!error) console.log("... rebooting");
                    });
                  }, 1000);
                  next_step();
              },

          ], callback);
    },

    // copy /ch/version.txt to .app/views for easier reading of the version file.
    _load_box_info = function(callback) {

          async.series([

              function get_software_version(next_step) {
                if (fs.existsSync('/ch/version.txt', 'utf8')) {
                  fs.readFile('/ch/version.txt', (err, data) => {
                    if (err) throw err;
                      box_info.software_version = data.toString().replace(/\r?\n|\r/g, "");
                      console.log("software_version: " + box_info.software_version);
                      next_step();
                  });
                }
              },

              function get_system_version(next_step) {
                if (fs.existsSync('/ch/system-version.txt', 'utf8')) {
                  fs.readFile('/ch/system-version.txt', (err, data) => {
                    if (err) throw err;
                      box_info.system_version = data.toString().replace(/\r?\n|\r/g, "");
                      console.log("system_version: " + box_info.system_version);
                      next_step();
                  });
                }
              },

              function get_beta_code(next_step) {
                if (fs.existsSync('/ch/beta_code.txt', 'utf8')) {
                  fs.readFile('/ch/beta_code.txt', (err, data) => {
                    if (err) throw err;
                      box_info.beta_code = data.toString().replace(/\r?\n|\r/g, "");
                      console.log("beta_code: " + box_info.beta_code);
                      next_step();
                  });
                }
              },

          ], callback);
    },

    _get_box_info = function() {
      return box_info;
    };

    return {
        get_wifi_info:           _get_wifi_info,

        is_wifi_enabled:         _is_wifi_enabled,
        is_wifi_enabled_sync:    _is_wifi_enabled_sync,

        is_ap_enabled:           _is_ap_enabled,
        is_ap_enabled_sync:      _is_ap_enabled_sync,

        enable_ap_mode:          _enable_ap_mode,
        enable_wifi_mode:        _enable_wifi_mode,

        write_wifi_status:       _write_wifi_status,

        reboot:                  _reboot,

        load_box_info:           _load_box_info,
        get_box_info:           _get_box_info
    };
}
