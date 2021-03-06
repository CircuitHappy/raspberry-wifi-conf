var path                  = require("path"),
    util                  = require("util"),
    iwlist                = require("./iwlist"),
    edit_wifi             = require("./edit_stored_wifi")(),
    diagnostics           = require("./diagnostics"),
    update                = require("./software_updater"),
    express               = require("express"),
    bodyParser            = require('body-parser'),
    config                = require("../config.json"),
    http_test             = config.http_test_only;

// Helper function to log errors and send a generic status "SUCCESS"
// message to the caller
function log_error_send_success_with(success_obj, error, response) {
    if (error) {
        console.log("ERROR: " + error);
        response.send({ status: "ERROR", error: error });
    } else {
        success_obj = success_obj || {};
        success_obj["status"] = "SUCCESS";
        response.send(success_obj);
    }
    response.end();
}

/*****************************************************************************\
    Returns a function which sets up the app and our various routes.
\*****************************************************************************/
module.exports = function(wifi_manager, callback) {
    var app = express();

    // Configure the app
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "views"));
    app.set("trust proxy", true);

    // Setup static routes to public assets
    app.use(express.static(path.join(__dirname, "public")));
    app.use(bodyParser.json());

    // Setup HTTP routes for rendering views
    app.get("/", function(request, response) {
        response.render("index");
    });

    app.get("/add_wifi.html", function(request, response) {
        response.render("add_wifi");
    });

    app.get("/edit_wifi.html", function(request, response) {
        response.render("edit_wifi");
    });

    app.get("/diagnostics.html", function(request, response) {
        response.render("diagnostics");
    });

    app.get("/reboot.html", function(request, response) {
        response.render("reboot");
    });

    app.get("/update_software.html", function(request, response) {
        response.render("update_software");
    });

    // Setup HTTP routes for various APIs we wish to implement
    // the responses to these are typically JSON
    app.get("/api/rescan_wifi", function(request, response) {
        console.log("Server got /rescan_wifi");
        iwlist(function(error, result) {
            log_error_send_success_with(result[0], error, response);
        });
    });

    app.post("/api/list_stored_wifi", function(request, response) {
        var reset_wpa_config = request.body.reset_wpa_config;
        if (reset_wpa_config == undefined) {reset_wpa_config = false;}
        console.log("Server got /list_stored_wifi");
        edit_wifi.list_networks(reset_wpa_config, function(error, result) {
            log_error_send_success_with(result, error, response);
        });
    });

    app.get("/api/rescan_logs", function(request, response) {
        console.log("Server got /rescan_logs");
        diagnostics(function(error, result) {
            log_error_send_success_with(result[0], error, response);
        });
    });

    app.post("/api/remove_stored_wifi", function(request, response) {
      var network_id = request.body.id;
      if (network_id == undefined) {network_id = "";}
      console.log("Server got /api/remove_stored_wifi");
      edit_wifi.remove_network(network_id, function(error, result) {
        log_error_send_success_with(result[0], error, response);
      });
    });

    app.get("/api/update_stored_wifi", function(request, response) {
      console.log("Server got /api/update_stored_wifi");
      edit_wifi.update_stored_networks(function(error, result) {
        log_error_send_success_with(result[0], error, response);
      });
    });

    app.post("/api/update_software", function(request, response) {
      var new_beta_code = request.body.beta_code;
      if (new_beta_code == undefined) {new_beta_code = "";}
      console.log("Server got /api/update_software");
      console.log("new_beta_code: " + new_beta_code);
      update(new_beta_code, function(error, result) {
        log_error_send_success_with(result[0], error, response);
      });
    });

    app.get("/api/reboot", function(request, response) {
      console.log("Server got /api/reboot");

      wifi_manager.reboot(function(error) {
        if (error) {
          console.log("Reboot got an error: " + error);
        }
      });
    });

    app.get("/api/box_info", function(request, response) {
      console.log("Server got /api/box_info");
      log_error_send_success_with(wifi_manager.get_box_info(), false, response);
    });

    app.post("/api/enable_wifi", function(request, response) {
        var conn_info = {
            wifi_ssid:      request.body.wifi_ssid,
            wifi_passcode:  request.body.wifi_passcode,
        };

        //no error checks, just return to root page
        //no process.exit, so this should just keep the webserver running
        console.log("should be redirected to reboot.html now...");

        // TODO: If wifi did not come up correctly, it should fail
        // currently we ignore ifup failures.
        wifi_manager.enable_wifi_mode(conn_info, function(error) {
            if (error) {
                console.log("Enable Wifi ERROR: " + error);
                console.log("Attempt to re-enable AP mode");
                wifi_manager.enable_ap_mode(config.access_point.ssid, function(error) {
                    console.log("... AP mode reset");
                });
                response.redirect("/");
            }
            // Success! - exit
            console.log("Wifi Enabled! - Rebooting is next");
        });
    });

    // Listen on our server
    app.listen(config.server.port);
}
