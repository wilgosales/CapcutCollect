import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Dialogs 6.2 as Dialogs
import Qt.labs.platform 1.1 as Platform

Rectangle {
    id: collect
    objectName: "capcutCollectPanel"
    width: Math.min(640, parent.width - 32)
    height: Math.min(594, parent.height - 76)
    x: parent.width - width - 16
    y: 52
    z: 1000000
    color: "#172328"
    radius: 9
    border.color: "#00bfc7"
    property string bridgeUrl: __BRIDGE_URL__
    property string bridgeToken: __BRIDGE_TOKEN__
    property var projects: []
    property string projectFingerprint: ""
    property bool initialized: false
    property bool busy: false
    property string lastResult: ""
    property int networkFailures: 0
    property string lastExportFolder: ""
    property string pendingExportProjectId: ""

    function request(method, route, body, callback) {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            var data;
            try { data = JSON.parse(xhr.responseText); }
            catch (e) { callback("Could not connect to Collect.", null); return; }
            if (xhr.status < 200 || xhr.status >= 300) callback(data.error || "Operation failed", null);
            else callback(null, data);
        };
        xhr.open(method, bridgeUrl + route);
        xhr.setRequestHeader("Authorization", "Bearer " + bridgeToken);
        if (method === "POST") xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(body ? JSON.stringify(body) : "");
    }
    function refresh() {
        request("GET", "/state", null, function(error, data) {
            if (error) {
                networkFailures++;
                if (networkFailures >= 3) { status.text = "Collect disconnected. Restart the launcher."; busy = false; }
                return;
            }
            networkFailures = 0;
            var fingerprint = JSON.stringify(data.projects);
            if (fingerprint !== projectFingerprint) {
                var selectedId = projectSelect.currentIndex >= 0 && projects[projectSelect.currentIndex] ? projects[projectSelect.currentIndex].id : "";
                projects = data.projects;
                projectFingerprint = fingerprint;
                var index = -1;
                for (var i = 0; i < projects.length; i++) if (projects[i].id === selectedId) index = i;
                projectSelect.currentIndex = index;
            }
            if (!initialized) { lastExportFolder = data.outputRoot; importPath.text = data.importRoot; initialized = true; }
            busy = data.job.status === "running";
            status.text = data.job.message;
            if (data.job.status === "done" && data.job.result) {
                var signature = JSON.stringify(data.job.result);
                if (lastResult !== signature && data.job.operation === "export") packagePath.text = data.job.result.package;
                lastResult = signature;
            }
        });
    }
    function run(route, body) {
        busy = true;
        status.text = "Starting…";
        request("POST", route, body, function(error, data) {
            if (error) { status.text = error; busy = false; }
            else refresh();
        });
    }
    function closePanel() {
        request("POST", "/stop", {}, function(error, data) {
            if (error && busy) status.text = error;
            else collect.destroy();
        });
    }
    Dialogs.FileDialog {
        id: packageDialog
        title: "Select a CapCut Collect package"
        fileMode: Dialogs.FileDialog.OpenFile
        nameFilters: ["ZIP collection (*.zip)", "Legacy format (*.capcollect)"]
        onAccepted: packagePath.text = selectedFile.toString()
    }
    Platform.FolderDialog {
        id: importFolderDialog
        title: "Select a collection folder"
        onAccepted: packagePath.text = folder.toString()
    }
    Platform.FolderDialog {
        id: exportFolderDialog
        title: "Choose export destination"
        onAccepted: {
            collect.lastExportFolder = folder.toString();
            var projectId = collect.pendingExportProjectId;
            collect.pendingExportProjectId = "";
            collect.run("/export", {projectId: projectId, outputRoot: folder.toString(), format: exportFormat.currentIndex === 0 ? "zip" : "folder"});
        }
        onRejected: { collect.pendingExportProjectId = ""; }
    }
    Flickable {
        anchors.fill: parent
        anchors.margins: 16
        contentWidth: width
        contentHeight: 578
        clip: true
        Column {
            width: parent.width
            spacing: 8
            Row {
                width: parent.width
                Text { width: parent.width - 80; height: 28; text: "CapCut Collect"; color: "white"; font.pixelSize: 19; font.bold: true }
                Button { width: 80; height: 28; text: "Close"; enabled: !collect.busy; onClicked: collect.closePanel() }
            }
            Text { text: "EXPORT PROJECT"; color: "#65d8dd"; font.pixelSize: 11 }
            ComboBox { id: projectSelect; objectName: "collectProjectSelect"; width: parent.width; height: 34; model: collect.projects; textRole: "name"; currentIndex: -1; displayText: currentIndex < 0 ? "Select a project…" : currentText; enabled: !collect.busy }
            ComboBox { id: exportFormat; width: parent.width; model: ["ZIP archive", "Uncompressed folder"]; enabled: !collect.busy }
            Button {
                objectName: "collectExportButton"
                width: parent.width; height: 44; text: "EXPORT"; font.pixelSize: 17; font.bold: true; palette.button: "#45dcd0"; palette.buttonText: "#092a2c"; enabled: !collect.busy && projectSelect.currentIndex >= 0
                onClicked: {
                    collect.pendingExportProjectId = collect.projects[projectSelect.currentIndex].id;
                    if (collect.lastExportFolder.length > 0) {
                        var folderUrl = collect.lastExportFolder;
                        if (folderUrl.indexOf("file:") !== 0) folderUrl = "file:///" + folderUrl.replace(/\\/g, "/");
                        exportFolderDialog.folder = folderUrl;
                    }
                    exportFolderDialog.open();
                }
            }
            Rectangle { width: parent.width; height: 1; color: "#365057" }
            Text { text: "IMPORT COLLECTION"; color: "#65d8dd"; font.pixelSize: 11 }
            Row {
                width: parent.width; spacing: 8
                TextField { id: packagePath; objectName: "collectPackagePath"; width: parent.width - 108; height: 34; placeholderText: "Select or paste the .zip path"; selectByMouse: true; enabled: !collect.busy }
                Button { width: 100; height: 34; text: "Browse…"; enabled: !collect.busy; onClicked: packageDialog.open() }
            }
            Button { text: "Select an uncompressed folder…"; enabled: !collect.busy; onClicked: importFolderDialog.open() }
            Text { text: "CapCut project library folder"; color: "#d3dfe2"; font.pixelSize: 12 }
            TextField { id: importPath; objectName: "collectImportPath"; width: parent.width; height: 34; selectByMouse: true; enabled: !collect.busy }
            Button {
                objectName: "collectImportButton"
                width: parent.width; height: 44; text: "IMPORT"; font.pixelSize: 17; font.bold: true; palette.button: "#45dcd0"; palette.buttonText: "#092a2c"; enabled: !collect.busy && packagePath.text.length > 0
                onClicked: collect.run("/import", {packagePath: packagePath.text, importRoot: importPath.text})
            }
            BusyIndicator { width: 24; height: collect.busy ? 24 : 0; running: collect.busy; visible: collect.busy }
            TextArea { id: status; objectName: "collectStatus"; width: parent.width; height: 80; readOnly: true; selectByMouse: true; wrapMode: TextEdit.Wrap; color: "#e2f0f2"; text: "Connecting…"; background: Rectangle { color: "#0e191d"; radius: 4 } }
            Text { width: parent.width; wrapMode: Text.WordWrap; text: "Creates a new project with its own identity. Restart CapCut to refresh its list if needed. Collect does not edit the global index."; color: "#a7bfc4"; font.pixelSize: 11 }
        }
    }
    Timer { interval: 1200; repeat: true; running: true; onTriggered: collect.refresh() }
    Component.onCompleted: refresh()
}
