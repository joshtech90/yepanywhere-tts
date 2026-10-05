# The minified test APK retains the old differential backend. Desktop-only
# JNA window handles and Nimbus's unused SRP command-line tool cannot execute
# on Android; they are the only references to these absent desktop classes.
-dontwarn java.awt.Component
-dontwarn java.awt.Window
-dontwarn javax.xml.bind.DatatypeConverter
