package com.poultryflock.pro;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeDownloader")
public class NativeDownloaderPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String fileName = call.getString("fileName");
        String base64Data = call.getString("base64Data");
        String mimeType = call.getString("mimeType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        boolean openImmediately = call.getBoolean("openImmediately", false);
        boolean shareImmediately = call.getBoolean("shareImmediately", false);

        if (fileName == null || fileName.trim().isEmpty()) {
            call.reject("File name is required");
            return;
        }

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("Base64 data is required");
            return;
        }

        // Clean base64 data if data URL prefix exists
        int commaIndex = base64Data.indexOf(',');
        if (commaIndex != -1) {
            base64Data = base64Data.substring(commaIndex + 1);
        }

        byte[] fileBytes;
        try {
            fileBytes = Base64.decode(base64Data, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("Failed to decode Base64 data: " + e.getMessage());
            return;
        }

        Uri savedUri = null;
        String savedPath = null;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ (API 29+): Scoped Storage via MediaStore.Downloads
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues contentValues = new ContentValues();
                contentValues.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                contentValues.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                contentValues.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                contentValues.put(MediaStore.Downloads.IS_PENDING, 1);

                savedUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues);
                if (savedUri == null) {
                    throw new Exception("MediaStore failed to create target download entry");
                }

                try (OutputStream outputStream = resolver.openOutputStream(savedUri)) {
                    if (outputStream == null) {
                        throw new Exception("Unable to open output stream for MediaStore URI");
                    }
                    outputStream.write(fileBytes);
                    outputStream.flush();
                }

                contentValues.clear();
                contentValues.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(savedUri, contentValues, null, null);
                savedPath = Environment.DIRECTORY_DOWNLOADS + "/" + fileName;

            } else {
                // Legacy Android (< API 29): Direct public Downloads directory
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs();
                }
                File targetFile = new File(downloadsDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                    fos.write(fileBytes);
                    fos.flush();
                }
                savedPath = targetFile.getAbsolutePath();
                savedUri = Uri.fromFile(targetFile);

                MediaScannerConnection.scanFile(
                    getContext(),
                    new String[]{targetFile.getAbsolutePath()},
                    new String[]{mimeType},
                    null
                );
            }

            // Also keep an app-accessible cache copy for FileProvider sharing/opening
            File cacheFile = new File(getContext().getCacheDir(), fileName);
            try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
                fos.write(fileBytes);
                fos.flush();
            }

            // Show user-friendly Android Toast
            final String finalFileName = fileName;
            getActivity().runOnUiThread(() -> {
                Toast.makeText(getContext(), "✅ Saved to Downloads: " + finalFileName, Toast.LENGTH_LONG).show();
            });

            // Optional open/share intent
            if (openImmediately || shareImmediately) {
                try {
                    Uri shareUri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        cacheFile
                    );

                    Intent intent = new Intent(shareImmediately ? Intent.ACTION_SEND : Intent.ACTION_VIEW);
                    if (shareImmediately) {
                        intent.putExtra(Intent.EXTRA_STREAM, shareUri);
                        intent.setType(mimeType);
                    } else {
                        intent.setDataAndType(shareUri, mimeType);
                    }
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                    Intent chooser = Intent.createChooser(intent, shareImmediately ? "Share Excel Report" : "Open Excel Report");
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(chooser);
                } catch (Exception ex) {
                    // Non-critical if user doesn't have an Excel viewer app installed
                }
            }

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("fileName", fileName);
            result.put("path", savedPath);
            result.put("uri", savedUri != null ? savedUri.toString() : "");
            result.put("message", "File saved directly to device Downloads folder");
            call.resolve(result);

        } catch (Exception e) {
            // Fallback: save to app external files / cache dir
            try {
                File fallbackDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (fallbackDir == null) {
                    fallbackDir = getContext().getCacheDir();
                }
                File fallbackFile = new File(fallbackDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(fallbackFile)) {
                    fos.write(fileBytes);
                    fos.flush();
                }
                Uri fallbackUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    fallbackFile
                );

                final String finalFileName = fileName;
                getActivity().runOnUiThread(() -> {
                    Toast.makeText(getContext(), "Saved: " + finalFileName, Toast.LENGTH_SHORT).show();
                });

                JSObject result = new JSObject();
                result.put("success", true);
                result.put("fileName", fileName);
                result.put("path", fallbackFile.getAbsolutePath());
                result.put("uri", fallbackUri.toString());
                result.put("message", "File saved to app storage directory");
                call.resolve(result);
            } catch (Exception fallbackError) {
                call.reject("Failed to save file: " + e.getMessage());
            }
        }
    }
}
