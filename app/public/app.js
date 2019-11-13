"use strict";

/***
 *  Define the app and inject any modules we wish to
 *  refer to.
***/
var app = angular.module("RpiWifiConfig", []);

/******************************************************************************\
Function:
    AppController

Dependencies:
    ...

Description:
    Main application controller
\******************************************************************************/
app.controller("AppController", ["PiManager", "$scope", "$location", "$timeout",

    function(PiManager, $scope, $location, $timeout) {
        // Scope variable declaration
        $scope.scan_results              = [];
        $scope.selected_cell             = null;
        $scope.scan_running              = false;
        $scope.update_running            = false;
        $scope.update_status_message     = "";
        $scope.network_passcode          = "";
        $scope.show_passcode_entry_field = false;
        $scope.show_reboot_message       = false;
        $scope.show_save_message         = false;
        $scope.no_results                = true;
        $scope.beta_code                 = "";
        $scope.system_version            = "";
        $scope.software_version          = "";
        $scope.ssid_name                 = "";
        $scope.ssid_passphrase           = "";
        $scope.hidden_ssid               = false;
        $scope.ap_mode                   = "not_set";
        $scope.wifi_status               = "not_set";

        // Scope filter definitions
        $scope.orderScanResults = function(cell) {
            return parseInt(cell.signal_strength);
        }

        // Scope function definitions
        $scope.rescan = function() {
            $scope.scan_results = [];
            $scope.selected_cell = null;
            $scope.scan_running = true;
            PiManager.rescan_wifi().then(function(response) {
                if (response.data.status == "SUCCESS") {
                    $scope.scan_results = response.data.scan_results;
                }
                $scope.scan_running = false;
            });
        }

        $scope.rescan_logs = function() {
            $scope.scan_results = [];
            $scope.scan_running = true;
            PiManager.rescan_logs().then(function(response) {
                if (response.data.status == "SUCCESS") {
                  $scope.syslog = response.data.syslog;
                  $scope.missing_link_log = response.data.missing_link;
                  $scope.ch_box_admin_log = response.data.ch_box_admin;
                }
                $scope.scan_running = false;
            });
        }

        $scope.get_box_info = function() {
            PiManager.get_box_info().then(function(response) {
              $scope.beta_code = response.data.beta_code;
              $scope.software_version = response.data.software_version;
              $scope.system_version = response.data.system_version;
              $scope.ap_mode = response.data.ap_mode;
              $scope.wifi_status = response.data.wifi_status;
            });
        }

        $scope.change_selection = function(cell) {
            $scope.network_passcode = "";
            $scope.selected_cell = cell;
            $scope.show_passcode_entry_field = (cell != null) ? true : false;
        }

        $scope.submit_selection = function() {
            if (!$scope.selected_cell) return;

            var wifi_info = {
                wifi_ssid:      $scope.selected_cell["ssid"],
                wifi_passcode:  $scope.network_passcode,
            };
            if (wifi_info["wifi_passcode"].length >= 8 && wifi_info["wifi_passcode"].length <= 63) {
              PiManager.enable_wifi(wifi_info);
              $scope.show_passcode_entry_field = false;
              $scope.show_reboot_message = true;
              PiManager.reboot_box();
            } else {
              alert("WiFi password needs to be between 8 and 63 characters in length.");
            }
        }

        $scope.get_software = function() {
          var updater_info = {
            beta_code: $scope.beta_code.toLowerCase(),
          };
          $scope.download_status_message = "Downloading update...";
          $scope.update_running = true;
          PiManager.update_software(updater_info).then(function(response) {
            if (response.data.status == "SUCCESS") {
              $scope.update_status_message = "New software installed. Rebooting your Missing Link.";
              console.log("About to reboot.");
              $scope.rebooting = true;
              PiManager.reboot_box();
            } else {
              console.log("error code: " + response.data.error["code"]);
              switch (response.data.error["code"]) {
                case 1:
                  $scope.update_status_message = "No updates available.";
                  break;
                case 2:
                  $scope.update_status_message = "Error downloading update. Try again in a few minutes. Contact support if this problem persists.";
                  break;
                case 3:
                  $scope.update_status_message = "Error validating installer. Try again in a few minutes. Contact support if this problem persists.";
                  break;
                case 4:
                  $scope.update_status_message = "Error extracting installer files. Try again in a few minutes. Contact support if this problem persists.";
                  break;
                case 5:
                  $scope.update_status_message = "Error relinking files. Your system might need to be reinstalled. Please contact support to find out how to do this.";
                  break;
                default:
                  $scope.update_status_message = "Updater hit an unexpected error. Is this device connected to the Internet?";
              }
            }
            $scope.update_running = false;
          });
        }

        // Scope function definitions
        $scope.list_stored_wifi = function() {
            $scope.scan_results = [];
            $scope.selected_network = null;
            $scope.scan_running = true;
            $scope.no_results = false;
          PiManager.list_stored_wifi(true).then(function(response) {
              if (response.data.status == "SUCCESS") {
                $scope.scan_results = response.data.scan_results;
                if (response.data.scan_results.length > 0) {
                  $scope.no_results = false;
                } else {
                  $scope.no_results = true;
                }
              }
              $scope.scan_running = false;
            });
        }

        $scope.remove_network = function(network_id) {
          $scope.scan_results = [];
          $scope.selected_network = null;
          $scope.scan_running = true;
          $scope.no_results = false;
          PiManager.remove_stored_wifi(parseInt(network_id, 10)).then(function(response) {
            if (response.data.status == "SUCCESS") {
              $scope.show_save_message = true;
              PiManager.list_stored_wifi(false).then(function(response) {
                if (response.data.status == "SUCCESS") {
                  $scope.scan_results = response.data.scan_results;
                  if (response.data.scan_results.length > 0) {
                    $scope.no_results = false;
                  } else {
                    $scope.no_results = true;
                  }
                }
              });
            } else {
              console.log("error removing network: " + response.data.error);
            }
            $scope.scan_running = false;
          });

      }

      $scope.update_stored_networks = function() {
        $scope.update_running = true;
        PiManager.update_stored_wifi().then(function(response) {
          if (response.data.status == "SUCCESS") {
            $scope.update_running = false;
            $scope.update_status_message = "Saved Stored Networks. Rebooting your Missing Link.";
            console.log("About to reboot.");
            $scope.rebooting = true;
            $scope.show_reboot_message = true;
            PiManager.reboot_box();
          }
        });
      }

      $scope.get_ssid_settings = function() {
          PiManager.get_ssid_settings().then(function(response) {
            $scope.ssid = response.data.ssid;
            $scope.hidden_ssid = response.data.hidden_ssid ? true : false;
            $scope.ssid_passphrase = response.data.passphrase;
          });
      }

      $scope.submit_ap_settings = function() {
          var alertMessage = "";
          var ssid_settings = {};
          ssid_settings.ssid = $scope.ssid;
          ssid_settings.hidden_ssid = $scope.hidden_ssid;
          ssid_settings.ssid_passphrase = $scope.ssid_passphrase;
          $scope.update_running = true;
          if (ssid_settings.ssid.match(/[;&()|*?[\]{}><&!^"\'\\$]/g) != null) {
            alertMessage += "Access Point Name should not contain and of these characters:\n" + '; & ( ) | * ? [ ] { } > < & ! ^ " \' \\ $ ' + "\n\n";
          }
          if (ssid_settings.ssid.length == 0 && ssid_settings.ssid.length <= 32) {
            alertMessage += "Access Point Name must be between 1 and 32 characters long.\n\n";
          }
          if ((ssid_settings.ssid_passphrase.length < 8) || (ssid_settings.ssid_passphrase.length > 63)) {
            alertMessage += "Access Point password needs to be between 8 and 63 characters in length.\n\n";
          }
          if (alertMessage == "") {
            PiManager.update_ssid_settings(ssid_settings).then(function(response) {
              if (response.data.status == "SUCCESS") {
                $scope.update_running = false;
                $scope.rebooting = true;
                $scope.show_reboot_message = true;
                PiManager.reboot_box();
              }
            });
          } else {
            alert(alertMessage);
            $scope.update_running = false;
          }
      }

      $scope.reset_ap_settings = function() {
          PiManager.reset_ssid_defaults().then(function(response) {
            if (response.data.status == "SUCCESS") {
              $scope.update_running = false;
              $scope.rebooting = true;
              console.log("would be rebooting now.");
              PiManager.reboot_box();
            }
          });
      }

        // Get any information about Missing Link box stored server side
        $scope.get_box_info();
    }]
);

/*****************************************************************************\
    Service to hit the rpi wifi config server
\*****************************************************************************/
app.service("PiManager", ["$http",

    function($http) {
        return {
            rescan_wifi: function() {
                return $http.get("/api/rescan_wifi");
            },
            list_stored_wifi: function(reset_wpa_config) {
                return $http.post("/api/list_stored_wifi", {reset_wpa_config: reset_wpa_config});
            },
            remove_stored_wifi: function(id) {
                return $http.post("/api/remove_stored_wifi", {id: id});
            },
            update_stored_wifi: function() {
                return $http.get("/api/update_stored_wifi");
            },
            rescan_logs: function() {
                return $http.get("/api/rescan_logs");
            },
            enable_wifi: function(wifi_info) {
                return $http.post("/api/enable_wifi", wifi_info);
            },
            update_software: function(updater_info) {
                return $http.post("/api/update_software", updater_info);
            },
            reboot_box: function() {
                return $http.get("/api/reboot");
            },
            get_box_info: function() {
                return $http.get("/api/box_info");
            },
            update_ssid_settings: function(ssid_settings) {
                return $http.post("/api/update_ssid", ssid_settings);
            },
            get_ssid_settings: function() {
                return $http.get("/api/get_ssid_settings");
            },
            reset_ap_settings: function() {
                return $http.get("/api/reset_ssid_settings");
            }
        };
    }]

);

/*****************************************************************************\
    Directive to show / hide / clear the password prompt
\*****************************************************************************/
app.directive("rwcPasswordEntry", function($timeout) {
    return {
        restrict: "E",

        scope: {
            visible:  "=",
            passcode: "=",
            reset:    "&",
            submit:   "&",
        },

        replace: true,          // Use provided template (as opposed to static
                                // content that the modal scope might define in the
                                // DOM)
        template: [
            "<div class='rwc-password-entry-container' ng-class='{\"hide-me\": !visible}'>",
            "    <div class='box'>",
            "         <input type = 'password' placeholder = 'Passcode...' ng-model = 'passcode' />",
            "         <div class = 'btn btn-cancel' ng-click = 'reset(null)'>Cancel</div>",
            "         <div class = 'btn btn-ok' ng-click = 'submit()'>Submit</div>",
            "    </div>",
            "</div>"
        ].join("\n"),

        // Link function to bind modal to the app
        link: function(scope, element, attributes) {
        },
    };
});
